import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { createApiTest } from "../test/integration/apiTest";
import { setupMachineWebSocket } from "../routes/daemon";
import { AgentOrchestrator } from "../services/agentOrchestrator";
import { createLocalReplicaStateStore } from "./localReplicaStateStore";
import { agents } from "../db/schema";

const test = createApiTest({ onboardingOpenerFlagDefaultEnabled: false });
afterEach(() => { vi.unstubAllEnvs(); });

async function waitUntil(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try { await exited; } finally { clearTimeout(force); }
}

test("two independent native runner processes enroll and keep file access bound to their Computer", async ({ app, seed, http, db }) => {
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standalone");
  vi.stubEnv("APP_URL", app.baseUrl);
  vi.stubEnv("AGENT_BOOTSTRAP_TOKEN_PEPPER", "private-runner-test-pepper-at-least-32-characters");
  const owner = await seed.human();
  const server = await seed.server({ owner });
  const directory = await mkdtemp(path.join(os.tmpdir(), "raft-two-runners-"));
  const orchestrator = new AgentOrchestrator(createLocalReplicaStateStore());
  const sockets = setupMachineWebSocket(app.server, orchestrator);
  const children: ChildProcess[] = [];
  const ids: string[] = [];
  try {
    for (const name of ["runner-a", "runner-b"]) {
      const home = path.join(directory, name);
      const state = path.join(home, "raft");
      await mkdir(home, { mode: 0o700 });
      const child = spawn(process.execPath, ["--import", "@oxc-node/core/register", "src/standaloneRemote.ts", "setup",
        "--server-url", app.baseUrl, "--server", server.slug, "--name", name], {
        cwd: fileURLToPath(new URL("../../../daemon/", import.meta.url)),
        // Empty native homes and no runtime binaries: this test never calls a model.
        env: { HOME: home, RAFT_HOME: state, PATH: "/nonexistent" }, stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      let output = "";
      let failure = "";
      child.stdout!.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr!.on("data", (chunk: Buffer) => { failure = (failure + chunk.toString()).slice(-2000); });
      await waitUntil(async () => {
        if (child.exitCode !== null) throw new Error(`Runner stopped before authorization: ${failure}`);
        return /approve code: ([A-Z0-9]{4}-[A-Z0-9]{4})/.test(output);
      }, "device code");
      const userCode = output.match(/approve code: ([A-Z0-9]{4}-[A-Z0-9]{4})/)![1];
      const approved = await http.as(owner, server).request("/api/auth/device/approve", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userCode }),
      });
      assert.equal(approved.status, 200);
      let id = "";
      await waitUntil(async () => {
        if (child.exitCode !== null) throw new Error(`Runner stopped before connection: ${failure}`);
        try { id = JSON.parse(await readFile(path.join(state, "attachment.json"), "utf8")).machineId; }
        catch { return false; }
        return await orchestrator.getMachineStatus(id) === "online";
      }, "authenticated runner connection");
      ids.push(id);
    }
    assert.notEqual(ids[0], ids[1]);
    const keyA = await readFile(path.join(directory, "runner-a/raft/computer.key"), "utf8");
    const keyB = await readFile(path.join(directory, "runner-b/raft/computer.key"), "utf8");
    assert.notEqual(keyA, keyB);
    const agentIds = [randomUUID(), randomUUID()];
    for (let index = 0; index < ids.length; index++) {
      await db.insert(agents).values({ id: agentIds[index], serverId: server.id, name: `probe-${index}`, machineId: ids[index] });
      // Both hosts have the same paths, but different contents. Routing must
      // follow the persisted Computer binding rather than a local path match.
      for (const host of ["runner-a", "runner-b"]) {
        const workspace = path.join(directory, host, "raft", "agents", agentIds[index]);
        await mkdir(workspace, { recursive: true });
        await writeFile(path.join(workspace, "host.txt"), host);
      }
      assert.equal((await orchestrator.readAgentFile(agentIds[index], "host.txt")).content, index === 0 ? "runner-a" : "runner-b");
    }
    await stop(children[1]);
    await waitUntil(async () => await orchestrator.getMachineStatus(ids[1]) === "offline", "remote disconnect");
    assert.equal(await orchestrator.getMachineStatus(ids[0]), "online");
    await assert.rejects(orchestrator.readAgentFile(agentIds[1], "host.txt"), /connected machine|WebSocket not ready/);
    assert.equal((await orchestrator.readAgentFile(agentIds[0], "host.txt")).content, "runner-a");
  } finally {
    await Promise.all(children.map(stop));
    await orchestrator.shutdown();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 90_000);

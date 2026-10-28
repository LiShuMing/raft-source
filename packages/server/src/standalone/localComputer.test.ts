import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { computers } from "../db/schema";
import { createApiTest } from "../test/integration/apiTest";
import { deleteMachine } from "../services/machineService";
import { LocalComputerManager, localRunnerEnvironment } from "./localComputer";

const test = createApiTest({ onboardingOpenerFlagDefaultEnabled: false });

function fakeRunner() {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperty(child, "exitCode", { value: null, configurable: true });
  child.kill = () => {
    Object.defineProperty(child, "exitCode", { value: 0, configurable: true });
    queueMicrotask(() => child.emit("close", 0, null));
    return true;
  };
  return child;
}

afterEach(() => { vi.unstubAllEnvs(); });

test("authenticated local attach is private, idempotent and resumes the same Computer", async ({ app, seed, http, db }) => {
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standalone");
  const dir = await mkdtemp(path.join(os.tmpdir(), "raft-local-computer-"));
  const owner = await seed.human();
  const member = await seed.human();
  const server = await seed.server({ owner, members: [member] });
  const launch = vi.fn(fakeRunner);
  let manager = new LocalComputerManager({ stateDir: dir, origin: "http://127.0.0.1:5280", machineStatus: async () => "offline", launch });
  app.app.set("localComputerManager", manager);
  try {
    const url = `/api/servers/${server.id}/local-computer`;
    assert.equal((await fetch(`${app.baseUrl}${url}`, { method: "POST" })).status, 401);
    assert.equal((await http.as(member, server).request(url, { method: "POST" })).status, 403);
    assert.equal(launch.mock.calls.length, 0);
    const [first, again] = await Promise.all([
      http.as(owner, server).request(url, { method: "POST" }),
      http.as(owner, server).request(url, { method: "POST" }),
    ]);
    assert.equal(first.status, 200);
    assert.equal(again.status, 200);
    const publicState = await first.json();
    assert.equal(publicState.state, "starting");
    assert.ok(publicState.machineId);
    assert.equal(JSON.stringify(publicState).includes("sk_computer_"), false);
    assert.equal(launch.mock.calls.length, 1);
    assert.equal((await db.select().from(computers)).length, 1);
    const keyFile = path.join(dir, "computers", server.id, "computer.key");
    const key = await readFile(keyFile, "utf8");
    assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(keyFile))).mode & 0o777, 0o700);

    await manager.stop();
    manager = new LocalComputerManager({ stateDir: dir, origin: "http://127.0.0.1:5280", machineStatus: async () => "online", launch });
    app.app.set("localComputerManager", manager);
    await manager.resume();
    assert.equal(launch.mock.calls.length, 2);
    const restored = await manager.status(server.id, owner.id);
    assert.equal(restored.machineId, publicState.machineId);
    assert.equal(restored.state, "online");
    assert.equal(await readFile(keyFile, "utf8"), key);
    assert.equal((await db.select().from(computers)).length, 1);
    vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standard");
    assert.equal((await http.as(owner, server).request(url, { method: "POST" })).status, 404);
  } finally {
    await manager.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("revoked attachments do not reconnect or silently create replacement credentials", async ({ seed }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "raft-local-revoked-"));
  const owner = await seed.human();
  const server = await seed.server({ owner });
  const launch = vi.fn(fakeRunner);
  const options = { stateDir: dir, origin: "http://127.0.0.1:5280", machineStatus: async () => "offline", launch };
  const first = new LocalComputerManager(options);
  const second = new LocalComputerManager(options);
  try {
    const attachment = await first.connect(server.id, owner.id);
    await first.stop();
    await deleteMachine(attachment.machineId);
    await second.resume();
    assert.equal(launch.mock.calls.length, 1);
    await assert.rejects(second.connect(server.id, owner.id), /revoked or changed/);
    assert.equal(launch.mock.calls.length, 1);
  } finally {
    await first.stop();
    await second.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner keeps native configuration locations and excludes server credentials", () => {
  const base = {
    HOME: "/native-home", PATH: "/native-bin", CLAUDE_CONFIG_DIR: "/native-claude", CODEX_HOME: "/native-codex",
    JWT_SECRET: "server-only", DATABASE_URL: "server-only", AGENT_API_KEY_HMAC_SECRET: "server-only", SLOCK_PROVIDER_CREDENTIAL_KEY: "server-only",
    NODE_OPTIONS: "server-only", ANTHROPIC_BASE_URL: "https://models.example.test", OPENAI_API_KEY: "native-provider",
  };
  const env = localRunnerEnvironment("/isolated-raft", base);
  for (const key of ["HOME", "PATH", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "ANTHROPIC_BASE_URL", "OPENAI_API_KEY"] as const) assert.equal(env[key], base[key]);
  for (const key of ["JWT_SECRET", "DATABASE_URL", "AGENT_API_KEY_HMAC_SECRET", "SLOCK_PROVIDER_CREDENTIAL_KEY", "NODE_OPTIONS"]) assert.equal(env[key], undefined);
  assert.equal(env.RAFT_HOME, "/isolated-raft");
  assert.equal(env.SLOCK_HOME, "/isolated-raft");
  assert.equal(env.SLOCK_DAEMON_TRACE_UPLOAD_DISABLED, "1");
  assert.equal(base.JWT_SECRET, "server-only");
});

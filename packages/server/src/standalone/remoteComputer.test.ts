import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { createApiTest } from "../test/integration/apiTest";
import { findComputerByApiKey } from "../services/computerCredentialService";
import { computers } from "../db/schema";
import { eq } from "drizzle-orm";

const test = createApiTest({ onboardingOpenerFlagDefaultEnabled: false });
afterEach(() => { vi.unstubAllEnvs(); });

test("private runner downloads require workspace admin and verify the published artifact", async ({ app, seed, http }) => {
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standalone");
  const dir = await mkdtemp(path.join(os.tmpdir(), "raft-remote-package-"));
  const owner = await seed.human();
  const member = await seed.human();
  const server = await seed.server({ owner, members: [member] });
  app.app.set("standaloneRemotePackageDir", dir);
  const base = `/api/servers/${server.id}/remote-computer`;
  try {
    assert.equal((await fetch(`${app.baseUrl}${base}`)).status, 401);
    assert.equal((await http.as(member, server).get(base)).status, 403);
    assert.equal((await (await http.as(owner, server).get(base)).json()).ready, false);
    const bytes = Buffer.from("synthetic offline runner archive");
    const filename = "raft-runner-linux-x64.tar.gz";
    await writeFile(path.join(dir, filename), bytes);
    await writeFile(path.join(dir, "remote-runner.json"), JSON.stringify({ filename, platform: "linux", arch: "x64", nodeMajor: 24, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }));
    const setup = await (await http.as(owner, server).get(base)).json();
    assert.equal(setup.ready, true);
    assert.equal(setup.serverSlug, server.slug);
    const downloaded = await http.as(owner, server).get(`${base}/download`);
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    await writeFile(path.join(dir, filename), Buffer.alloc(bytes.length, "x"));
    assert.equal((await http.as(owner, server).get(`${base}/download`)).status, 503);
    vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standard");
    assert.equal((await http.as(owner, server).get(base)).status, 404);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("device-approved remote Computers receive distinct revocable identities scoped to their workspace", async ({ app, seed, http, db }) => {
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standalone");
  vi.stubEnv("APP_URL", app.baseUrl);
  vi.stubEnv("AGENT_BOOTSTRAP_TOKEN_PEPPER", "private-runner-test-pepper-at-least-32-characters");
  const owner = await seed.human();
  const member = await seed.human();
  const server = await seed.server({ owner, members: [member] });
  const endpoint = "/api/computer/attach";
  const asUser = (user: { id: string }, route: string, body: object) => http.as(user, server).request(route, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const unboundAgent = await asUser(owner, "/api/agents", { name: "unbound-engineer", runtime: "claude", model: "sonnet" });
  assert.equal(unboundAgent.status, 400);
  assert.equal((await unboundAgent.json()).code, "execution_machine_required");
  assert.equal((await asUser(member, endpoint, { serverSlug: server.slug, name: "denied" })).status, 403);
  const post = (route: string, body: object) => fetch(`${app.baseUrl}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const authorization = await post("/api/auth/device/authorize", { clientName: "private-runner-test" });
  assert.equal(authorization.status, 201);
  const grant = await authorization.json();
  assert.equal((await post("/api/auth/device/token", { deviceCode: grant.deviceCode })).status, 400);
  assert.equal((await asUser(owner, "/api/auth/device/approve", { userCode: grant.userCode })).status, 200);
  const session = await (await post("/api/auth/device/token", { deviceCode: grant.deviceCode })).json();
  assert.ok(session.accessToken);
  assert.equal((await post("/api/auth/device/token", { deviceCode: grant.deviceCode })).status, 410);
  const attach = async (name: string) => {
    const response = await fetch(`${app.baseUrl}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` }, body: JSON.stringify({ serverSlug: server.slug, name }) });
    assert.equal(response.status, 201);
    return response.json();
  };
  const a = await attach(`host-a-${randomUUID().slice(0, 8)}`);
  const b = await attach(`host-b-${randomUUID().slice(0, 8)}`);
  assert.notEqual(a.machineId, b.machineId);
  assert.notEqual(a.apiKey, b.apiKey);
  assert.equal((await findComputerByApiKey(a.apiKey))?.machineId, a.machineId);
  assert.equal((await findComputerByApiKey(b.apiKey))?.machineId, b.machineId);
  await db.update(computers).set({ revokedAt: new Date() }).where(eq(computers.id, a.serverMachineId));
  assert.equal(await findComputerByApiKey(a.apiKey), null);
  assert.equal((await findComputerByApiKey(b.apiKey))?.machineId, b.machineId);
});

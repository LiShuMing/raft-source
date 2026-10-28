import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Run only against a dedicated standalone test profile. Does not call a model.
const origin = new URL(process.env.PERSONAL_SMOKE_ORIGIN || "http://127.0.0.1:5288");
assert.equal(origin.protocol, "http:");
assert.equal(origin.hostname, "127.0.0.1");
const output = path.resolve(process.env.PERSONAL_SMOKE_OUTPUT || ".local/personal-agent");
const suffix = randomUUID().slice(0, 8);
const { email, password } = JSON.parse(await readFile(path.join(output, "fixture-login.json"), "utf8"));
let token;
let serverId;

async function request(route, body, expected = 200) {
  const response = await fetch(new URL(`/api${route}`, origin), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(serverId ? { "X-Server-Id": serverId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${route}: unexpected HTTP ${response.status}`);
  return data;
}

const privacy = await request("/privacy-policy");
assert.ok(JSON.stringify(privacy).includes("standalone"), "use a standalone test profile");
await request("/agents", undefined, 401);
const account = await request("/auth/login", { email, password });
token = account.accessToken;
const server = await request("/servers", { name: "Personal Agent Review", slug: `personal-${suffix}` });
serverId = server.id;
const feature = await request("/feature-flags/evaluate", { keys: ["provider_connections_v0"], serverId, platform: "web" });
assert.equal(feature.evaluations[0].enabled, true);
const connection = await request("/provider-connections", { name: "Smoke test — dummy key, no model calls", providerId: "openai", apiKey: "dummy-local-smoke-key" }, 201);
const catalog = await request("/provider-connections");
assert.ok(!JSON.stringify(catalog).includes("dummy-local-smoke-key"));
const agent = await request("/agents", { external: true, name: "review-assistant", description: "Test fixture; external Agent, no model connected." });
const dm = await request("/channels/dm", { agentId: agent.id });
const randomId = randomUUID();
const body = { channelId: dm.id, content: "Review fixture: inspect only the dedicated test directory; no external actions.", asTask: true, randomId, timezone: "Asia/Shanghai" };
const first = await request("/v2/messages", body);
const repeated = await request("/v2/messages", body);
const messageId = first.message?.id ?? first.id;
assert.ok(messageId);
assert.equal(repeated.message?.id ?? repeated.id, messageId, "duplicate submission must reuse the persisted message");
const pageUrl = new URL(`/s/${server.slug}/personal`, origin).href;
assert.equal((await fetch(pageUrl)).status, 200);

await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(path.join(output, "review-login.json"), JSON.stringify({ email, password, pageUrl, serverId, connectionId: connection.id, agentId: agent.id, channelId: dm.id, messageId }, null, 2), { mode: 0o600 });
const evidence = { passed: true, origin: origin.origin, pageUrl, checks: ["authentication required", "local fixture sign-in", "personal workspace", "standalone provider feature", "encrypted provider save with dummy key", "secret-free catalog", "external fixture Agent", "DM task persistence", "randomId deduplication", "personal SPA route"], messageId, modelRequests: 0, note: "External fixture Agent has no execution runtime. This verifies API acceptance, not autonomous task completion." };
await writeFile(path.join(output, "api-smoke.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));

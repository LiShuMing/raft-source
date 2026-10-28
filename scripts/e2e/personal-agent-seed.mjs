import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Test fixtures are inserted directly; this does not accept vendor terms for a user.
// Stop the standalone test server before running with --import @oxc-node/core/register.
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(root, ".local/personal-agent");
const state = path.join(output, "state");
assert.equal(process.env.RAFT_STANDALONE_DIR, state, "seed only the dedicated review profile");
const origin = "http://127.0.0.1:5288";
let online = false;
try { await fetch(`${origin}/api/privacy-policy`); online = true; } catch {}
assert.equal(online, false, "stop the review server before opening its database");
const { configureStandalone } = await import("../../packages/server/src/standalone/config.ts");
await configureStandalone();
const { initDatabase, getDb, closeDatabase } = await import("../../packages/server/src/db/index.ts");
const { users } = await import("../../packages/server/src/db/schema.ts");
const require = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const argon2 = require("argon2");
await initDatabase(process.env.DATABASE_URL);
try {
  const suffix = randomUUID().slice(0, 8);
  const email = `personal-${suffix}@test.invalid`;
  const password = randomUUID();
  await getDb().insert(users).values({ email, name: `review-${suffix}`, displayName: "Personal Agent Review", passwordHash: await argon2.hash(password), emailVerified: true, passwordCredentialEstablishedAt: new Date(), profileSetupCompletedAt: new Date() });
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(path.join(output, "fixture-login.json"), JSON.stringify({ email, password }), { mode: 0o600 });
  console.log("Created a local test fixture in the dedicated review profile; no external account or model request.");
} finally { await closeDatabase(); }

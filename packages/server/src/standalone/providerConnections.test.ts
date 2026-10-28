import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { PROVIDER_CONNECTIONS_FEATURE_FLAG_KEY } from "@botiverse/raft-shared";
import { featureFlags, featureFlagRules, providerConnectionCredentials } from "../db/schema";
import { evaluateFeatureFlag } from "../services/featureFlagService";
import { createProviderConnection, listProviderConnections } from "../services/providerConnectionService";
import { dbTest } from "../test/integration/dbTest";
import { configureStandalone } from "./config";

afterEach(() => vi.unstubAllEnvs());

dbTest("standalone enables API connections by default while preserving standard rollout and explicit denials", async ({ db, seed }) => {
  const owner = await seed.human();
  const server = await seed.server({ owner });
  const key = PROVIDER_CONNECTIONS_FEATURE_FLAG_KEY;
  await db.insert(featureFlags).values({ key, randomizationUnit: "server", salt: key, defaultEnabled: false })
    .onConflictDoUpdate({ target: featureFlags.key, set: { enabled: true, killSwitch: false, defaultEnabled: false } });
  await db.delete(featureFlagRules).where(eq(featureFlagRules.flagKey, key));
  const input = { key, serverId: server.id, userId: owner.id };
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standard");
  assert.equal((await evaluateFeatureFlag(input)).enabled, false);
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standalone");
  assert.equal((await evaluateFeatureFlag(input)).enabled, true);
  assert.equal((await evaluateFeatureFlag({ key })).enabled, false);
  await db.insert(featureFlagRules).values({ flagKey: key, stage: "server", decision: "deny", values: [server.id] });
  assert.equal((await evaluateFeatureFlag(input)).enabled, false);
  await db.delete(featureFlagRules).where(eq(featureFlagRules.flagKey, key));
  await db.update(featureFlags).set({ killSwitch: true }).where(eq(featureFlags.key, key));
  assert.equal((await evaluateFeatureFlag(input)).enabled, false);
  await db.update(featureFlags).set({ killSwitch: false, enabled: false }).where(eq(featureFlags.key, key));
  assert.equal((await evaluateFeatureFlag(input)).enabled, false);
});

dbTest("a fresh standalone key encrypts real persisted credentials and the restart key decrypts them", async ({ db, seed }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "raft-provider-persistence-"));
  try {
    const env: NodeJS.ProcessEnv = { RAFT_STANDALONE_DIR: dir };
    await configureStandalone(env);
    vi.stubEnv("SLOCK_PROVIDER_CREDENTIAL_KEY", env.SLOCK_PROVIDER_CREDENTIAL_KEY!);
    const owner = await seed.human();
    const server = await seed.server({ owner });
    const dummy = "test-only-key-never-sent-to-a-provider";
    const connection = await createProviderConnection({ serverId: server.id, userId: owner.id, name: "API test", providerId: "openai", apiKey: dummy });
    const catalog = await listProviderConnections(server.id);
    assert.ok(!JSON.stringify(catalog).includes(dummy));
    const [row] = await db.select().from(providerConnectionCredentials).where(eq(providerConnectionCredentials.connectionId, connection.id));
    assert.ok(row && !row.encryptedApiKey.includes(dummy));
    const restarted: NodeJS.ProcessEnv = { RAFT_STANDALONE_DIR: dir };
    await configureStandalone(restarted);
    const [version, iv, tag, ciphertext] = row!.encryptedApiKey.split(":");
    assert.ok(version);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(restarted.SLOCK_PROVIDER_CREDENTIAL_KEY!, "base64"), Buffer.from(iv!, "base64url"));
    decipher.setAAD(Buffer.from(`${server.id}:${connection.id}`));
    decipher.setAuthTag(Buffer.from(tag!, "base64url"));
    assert.equal(Buffer.concat([decipher.update(Buffer.from(ciphertext!, "base64url")), decipher.final()]).toString(), dummy);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDeploymentMode } from "../config/deploymentMode";
import { configureStandalone, readOrCreateSigningKey, standalonePaths } from "./config";

test("standalone is opt-in and rejects unknown profiles or invalid ports", () => {
  assert.equal(getDeploymentMode({}), "standard");
  assert.equal(getDeploymentMode({ RAFT_DEPLOYMENT_MODE: "standalone" }), "standalone");
  assert.throws(() => getDeploymentMode({ RAFT_DEPLOYMENT_MODE: "typo" }));
  for (const port of ["0", "65536", "NaN", "1.5"]) {
    assert.throws(() => standalonePaths({ RAFT_STANDALONE_PORT: port }));
  }
});

test("concurrent first starts publish one complete private signing key and preserve it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "raft-standalone-key-"));
  try {
    const file = path.join(dir, "jwt-secret");
    const keys = await Promise.all(Array.from({ length: 8 }, () => readOrCreateSigningKey(file)));
    assert.equal(new Set(keys).size, 1);
    assert.equal(await readFile(file, "utf8"), keys[0]);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(await readOrCreateSigningKey(file), keys[0]);
    await writeFile(file, "broken");
    await assert.rejects(readOrCreateSigningKey(file), /Invalid signing key/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the standalone launcher isolates state from inherited cloud configuration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "raft-standalone-env-"));
  try {
    const env: NodeJS.ProcessEnv = {
      RAFT_STANDALONE_DIR: dir,
      DATABASE_URL: "postgres://remote.example/cloud",
      REDIS_URL: "redis://remote.example",
      RISINGWAVE_DATABASE_URL: "postgres://remote.example/risingwave",
      S3_ENDPOINT: "https://remote.example",
      JWT_SECRET: "inherited",
      RESEND_API_KEY: "inherited",
      HANDS_FEEDBACK_APP_TOKEN: "inherited",
      TRANSLATION_PROVIDER: "fake",
      OTLP_RELAY_TARGET_URL: "https://remote.example/trace",
      VAPID_PRIVATE_KEY: "inherited",
    };
    const first = await configureStandalone(env);
    const key = env.JWT_SECRET;
    await configureStandalone(env);
    assert.equal(env.JWT_SECRET, key);
    assert.notEqual(key, "inherited");
    assert.equal(env.DATABASE_URL, `pglite://${path.join(dir, "postgres")}`);
    assert.equal(env.APP_URL, first.origin);
    assert.equal(env.RAFT_DEPLOYMENT_MODE, "standalone");
    for (const name of ["REDIS_URL", "RISINGWAVE_DATABASE_URL", "S3_ENDPOINT", "RESEND_API_KEY", "HANDS_FEEDBACK_APP_TOKEN", "TRANSLATION_PROVIDER", "OTLP_RELAY_TARGET_URL", "VAPID_PRIVATE_KEY"]) {
      assert.equal(env[name], undefined);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

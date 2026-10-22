import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPiHostEnv, resolvePiAgentDir, piHostDefaultModel } from "./piHostConfig";

test("Pi loads native dotenv values without executing shell or replacing explicit environment", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "raft-pi-host-"));
  try {
    writeFileSync(path.join(root, ".env"), 'export LLM_MODEL="local-model"\nLLM_API_KEY=fixture\nLLM_BASE_URL=https://example.test/v1\nCOMMAND=$(touch should-not-exist)\n');
    const env = readPiHostEnv({ LLM_API_KEY: "explicit" }, root);
    assert.equal(env.LLM_MODEL, "local-model");
    assert.equal(env.LLM_API_KEY, undefined);
    assert.equal(env.COMMAND, "$(touch should-not-exist)");
    assert.deepEqual(readPiHostEnv({}, path.join(root, "absent")), {});
    assert.throws(() => readPiHostEnv({ PI_ENV_FILE: path.join(root, "missing") }), /Pi host environment file/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Pi explicit model and native settings precede unambiguous wrapper model default", () => {
  const defaults = { getDefaultProvider: () => undefined, getDefaultModel: () => undefined };
  const models = [{ provider: "local", id: "host" }];
  assert.equal(piHostDefaultModel("default", { LLM_MODEL: "host" }, defaults, models), "local/host");
  assert.equal(piHostDefaultModel("chosen/model", { LLM_MODEL: "host" }, defaults, models), "chosen/model");
  assert.equal(piHostDefaultModel("default", { LLM_MODEL: "host" }, { ...defaults, getDefaultModel: () => "saved" }, models), "default");
  assert.equal(piHostDefaultModel("default", { LLM_MODEL: "host" }, defaults, [...models, { provider: "other", id: "host" }]), "default");
  assert.equal(resolvePiAgentDir({ PI_CODING_AGENT_DIR: "~/native-pi" }, "/unused"), path.join(os.homedir(), "native-pi"));
});

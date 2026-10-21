import assert from "node:assert/strict";
import { buildLaunchPlan, hydrateRuntimeConfig, parseRuntimeConfig } from "./index";

const native = {
  version: 1,
  runtime: "claude",
  provider: { kind: "default" },
  model: { kind: "machine" },
  mode: { kind: "default" },
};

test("machine model policy survives storage and ignores stale legacy model/effort columns", () => {
  const parsed = parseRuntimeConfig({ runtimeConfig: native, model: "opus", reasoningEffort: "high" });
  assert.ok(parsed.ok);
  const restored = hydrateRuntimeConfig({ runtimeConfig: JSON.parse(JSON.stringify(parsed.config)), model: "opus", reasoningEffort: "high" });
  assert.deepEqual(restored.model, { kind: "machine" });
  const launch = buildLaunchPlan(restored);
  assert.equal(launch.model, "");
  assert.equal(launch.reasoningEffort, null);
  assert.deepEqual(launch.mode, { kind: "default" });
  assert.equal(launch.envVars, null, "no model or credential overrides generated");
});

test("machine settings rejects contradictory provider/model/effort/mode payloads", () => {
  for (const override of [
    { runtime: "codex", provider: undefined },
    { provider: { kind: "custom", apiUrl: "https://example.test", apiKey: "test-only" } },
    { model: { kind: "machine", id: "opus" } },
    { reasoningEffort: "high" },
    { mode: { kind: "fast" } },
  ]) assert.equal(parseRuntimeConfig({ runtimeConfig: { ...native, ...override } }).ok, false, JSON.stringify(override));
});

test("legacy Claude agents keep their explicit models", () => {
  for (const model of ["sonnet", "bailian/deepseek-v4.1-flash"]) {
    assert.equal(buildLaunchPlan(hydrateRuntimeConfig({ runtime: "claude", model })).model, model);
  }
});

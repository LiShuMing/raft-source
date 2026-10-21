import assert from "node:assert/strict";
import { initialRuntimeFormV2Values, parseRuntimeFormV2, validateRuntimeFormV2 } from "@botiverse/raft-runtime-form";
import type { RuntimeFormV2Sources } from "@botiverse/raft-runtime-form";
import { DAEMON_CAPABILITY_CLAUDE_MACHINE_SETTINGS, parseRuntimeConfig } from "@botiverse/raft-shared";
import { assertClaudeMachineSettingsSupported } from "./claudeMachineSettings";
import { buildRuntimeConfigFromFormValues, buildRuntimeFormV2, runtimeFormV2Entry, runtimeFormValuesFromRuntimeConfig } from "./runtimeFormV2Registry";

test("new Claude form inherits without a live model catalog; stale hidden fields cannot override it", async () => {
  const form = parseRuntimeFormV2(buildRuntimeFormV2("claude"))!;
  const result = await runtimeFormV2Entry("claude")!.resolveOptionSource({ sourceId: "provider" } as never);
  assert.equal(result.kind, "source");
  if (result.kind !== "source" || !result.source) throw new Error("provider source missing");
  const sources: RuntimeFormV2Sources = { provider: JSON.parse(JSON.stringify(result.source)), model: { sourceId: "model", kind: "select", pointer: "/model", options: [], status: "unavailable", retryable: true } };
  const initial = initialRuntimeFormV2Values(form, sources);
  assert.equal(initial.provider, "machine");
  assert.deepEqual(validateRuntimeFormV2(form, sources, initial), {});
  const built = buildRuntimeConfigFromFormValues("claude", {
    ...initial, model: "opus", apiKey: "stale-secret", apiUrl: "https://old.example.test", fastMode: true, reasoningEffort: "high",
  });
  assert.ok(built.ok);
  const parsed = parseRuntimeConfig({ runtimeConfig: built.runtimeConfig });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.config.model, { kind: "machine" });
  assert.deepEqual(parsed.config.provider, { kind: "default" });
  assert.equal(JSON.stringify(parsed.config).includes("stale-secret"), false);
  const restored = runtimeFormValuesFromRuntimeConfig(parsed.config);
  assert.ok(restored);
  assert.equal(restored.provider, "machine");
  assert.throws(() => assertClaudeMachineSettingsSupported(parsed.config, []), /selected Computer.*upgraded/);
  assert.doesNotThrow(() => assertClaudeMachineSettingsSupported(parsed.config, [DAEMON_CAPABILITY_CLAUDE_MACHINE_SETTINGS]));
});

test("existing explicit models round-trip as overrides and keep custom model IDs", () => {
  const old = parseRuntimeConfig({ runtimeConfig: { version: 1, runtime: "claude", provider: { kind: "default" }, model: { kind: "custom", name: "bailian/deepseek-v4.1-flash" } } });
  assert.ok(old.ok);
  const values = runtimeFormValuesFromRuntimeConfig(old.config);
  assert.ok(values);
  assert.equal(values.provider, "default");
  const built = buildRuntimeConfigFromFormValues("claude", values);
  assert.ok(built.ok);
  const parsed = parseRuntimeConfig({ runtimeConfig: built.runtimeConfig });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.config.model, old.config.model);
  assert.doesNotThrow(() => assertClaudeMachineSettingsSupported(parsed.config, []));
});

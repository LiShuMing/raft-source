import assert from "node:assert/strict";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "./helpers/domSetup";
import { applyRuntimeFormV2Change, initialRuntimeFormV2Values, parseRuntimeFormV2 } from "@botiverse/raft-runtime-form";
import type { RuntimeFormV2Sources } from "@botiverse/raft-runtime-form";
import definition from "@botiverse/raft-runtime-form/fixtures/claude.form.json";
import provider from "@botiverse/raft-runtime-form/fixtures/claude.option-source.provider.json";
import model from "@botiverse/raft-runtime-form/fixtures/claude.option-source.fallback.json";
import { TestIntlProvider } from "./helpers/intl";
import { RuntimeFormV2Fields } from "../src/components/agent/RuntimeConfigFields";
import { ClaudeConfigurationSummary } from "../src/components/agent/ClaudeConfigurationSummary";
import { buildRuntimeConfig, runtimeConfigProviderMode } from "../src/utils/runtimeConfigForm";

const form = parseRuntimeFormV2(definition)!;
const sources = { provider, model } as RuntimeFormV2Sources;

function Harness() {
  const [values, setValues] = useState(() => initialRuntimeFormV2Values(form, sources));
  return <RuntimeFormV2Fields form={form} sources={sources} values={values} showValidationErrors onChange={(key, value) => setValues(applyRuntimeFormV2Change(form, sources, values, key, value))} />;
}

afterEach(cleanup);

test("configuration choices hide native overrides and reveal the right connection fields", () => {
  render(<TestIntlProvider><Harness /></TestIntlProvider>);
  assert.equal(screen.queryByTestId("runtime-form-v2-model"), null);
  assert.equal(screen.queryByTestId("runtime-form-v2-fastMode"), null);
  assert.equal(screen.queryByTestId("runtime-form-v2-apiKey"), null);
  const choose = (name: string) => {
    fireEvent.change(screen.getByTestId("runtime-form-v2-provider"), { target: { value: name } });
    fireEvent.click(screen.getByRole("option", { name }));
  };
  choose("Override model");
  screen.getByTestId("runtime-form-v2-model");
  assert.equal(screen.queryByTestId("runtime-form-v2-apiKey"), null);
  choose("Custom connection");
  screen.getByTestId("runtime-form-v2-apiKey");
  screen.getByTestId("runtime-form-v2-apiUrl");
  choose("Machine settings");
  assert.equal(screen.queryByTestId("runtime-form-v2-model"), null);
  assert.equal(screen.queryByTestId("runtime-form-v2-apiKey"), null);
});

test("configuration summary follows the selected execution Computer, including offline state", () => {
  const view = render(<TestIntlProvider><ClaudeConfigurationSummary computer={{ id: "a", name: "admin", status: "online" }} mode="machine" /></TestIntlProvider>);
  view.rerender(<TestIntlProvider><ClaudeConfigurationSummary computer={{ id: "b", name: "dev2", status: "offline" }} mode="machine" /></TestIntlProvider>);
  const summary = screen.getByTestId("claude-configuration-summary");
  assert.match(summary.textContent!, /dev2/);
  assert.match(summary.textContent!, /Offline/);
  assert.match(summary.textContent!, /has not been verified/);
  assert.doesNotMatch(summary.textContent!, /admin|Sonnet|Opus/);
});

test("legacy editor preserves the machine policy while discarding hidden model and fast overrides", () => {
  const config = buildRuntimeConfig({ runtime: "claude", model: "opus", customModelMode: true, providerMode: "machine", fastMode: true, reasoningEffort: "high", providerApiKey: "stale-key" });
  assert.equal(runtimeConfigProviderMode(config), "machine");
  assert.deepEqual(config.model, { kind: "machine" });
  assert.deepEqual(config.mode, { kind: "default" });
  assert.equal(config.reasoningEffort, null);
  assert.equal(JSON.stringify(config).includes("stale-key"), false);
});

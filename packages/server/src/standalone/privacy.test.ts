import assert from "node:assert/strict";
import { vi } from "vitest";
import { getPrivacyPolicy, requireExternalService } from "../config/privacyPolicy";
import { getLatestComputerVersion, getLatestComputerReleaseNotes } from "../services/computerVersionService";
import { isProductFeedbackConfigured, submitProductFeedback } from "../services/productFeedbackService";
import { isTranslationProviderConfigured, resolveProviderFromRuntimeConfig } from "../services/messageTranslationService";
import { createSafeFetch } from "../services/managedMcpGateway";
import { postPublicHttps, drainAppNotificationDeliveries } from "../services/appNotificationDeliveryService";
import { localRunnerEnvironment } from "./localComputer";
import { isPushEnabled, sendPushToUsers } from "../services/pushService";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test("standalone rejects external services before any fetch even with inherited credentials", async () => {
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standalone");
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
  const env = { RAFT_DEPLOYMENT_MODE: "standalone", HANDS_FEEDBACK_BASE_URL: "https://audit.invalid", HANDS_FEEDBACK_APP_SLUG: "app", HANDS_FEEDBACK_CLIENT_KEY: "test", HANDS_FEEDBACK_APP_TOKEN: "test", HANDS_FEEDBACK_REPORTER_ID_SECRET: "test", TRANSLATION_PROVIDER: "fake" };
  assert.equal(isProductFeedbackConfigured(env), false);
  assert.equal(isTranslationProviderConfigured(env), false);
  assert.equal(await getLatestComputerVersion(), null);
  assert.equal(getLatestComputerReleaseNotes(), null);
  await assert.rejects(submitProductFeedback({} as never, { env }), /privacy policy/);
  await assert.rejects(resolveProviderFromRuntimeConfig(), /privacy policy/);
  assert.throws(() => createSafeFetch(), /privacy policy/);
  await assert.rejects(postPublicHttps({} as never), /privacy policy/);
  assert.deepEqual(await drainAppNotificationDeliveries(), { claimed: 0, delivered: 0, retried: 0, suppressed: 0, deadLettered: 0 });
  assert.equal(isPushEnabled(), false);
  assert.deepEqual(await sendPushToUsers(["test-user"], {} as never), { attempted: 0, delivered: 0, failed: 0 });
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(getPrivacyPolicy().nativeAgentNetworkIsolation, "not-enforced");
  assert.doesNotThrow(() => requireExternalService("Test service", { RAFT_DEPLOYMENT_MODE: "standard" }));
});

test("local native clients receive privacy controls without replacing provider credentials", () => {
  const env = localRunnerEnvironment("/private/raft", { ANTHROPIC_API_KEY: "native-provider", DISABLE_TELEMETRY: "0", DISABLE_AUTOUPDATER: "0" });
  assert.equal(env.ANTHROPIC_API_KEY, "native-provider");
  for (const key of ["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "DISABLE_TELEMETRY", "DISABLE_ERROR_REPORTING", "DISABLE_AUTOUPDATER"]) assert.equal(env[key], "1");
});

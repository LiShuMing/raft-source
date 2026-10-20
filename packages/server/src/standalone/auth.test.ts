import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { CURRENT_LEGAL_ACCEPTANCE } from "@botiverse/raft-shared";
import { emailVerifications, users } from "../db/schema";
import { createApiTest } from "../test/integration/apiTest";
import * as emailService from "../services/emailService";

const test = createApiTest({ onboardingOpenerFlagDefaultEnabled: false });
const email = "local-owner@example.test";
const password = "local-test-password";
const legalAcceptance = { acceptTerms: true, ...CURRENT_LEGAL_ACCEPTANCE };

beforeEach(() => {
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standalone");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function post(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("local registration needs no mailbox, issues real sessions and survives refresh", async ({ app, db }) => {
  const mail = vi.spyOn(emailService, "sendVerificationEmail").mockResolvedValue(undefined);
  const config = await fetch(`${app.baseUrl}/api/auth/providers`);
  assert.deepEqual(await config.json(), { deploymentMode: "standalone", providers: [] });
  const response = await post(app.baseUrl, "register", { email, password, ...legalAcceptance });
  assert.equal(response.status, 200);
  const registered = await response.json();
  assert.equal(registered.user.emailVerified, true);
  assert.ok(registered.accessToken);
  assert.ok(registered.refreshToken);
  assert.equal(mail.mock.calls.length, 0);
  assert.equal((await db.select().from(emailVerifications)).length, 0);
  const me = await fetch(`${app.baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${registered.accessToken}` } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).id, registered.user.id);
  const refreshed = await post(app.baseUrl, "refresh", { refreshToken: registered.refreshToken });
  assert.equal(refreshed.status, 200);
  const tokens = await refreshed.json();
  const restored = await fetch(`${app.baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
  assert.equal((await restored.json()).id, registered.user.id);
  assert.equal((await fetch(`${app.baseUrl}/api/auth/me`)).status, 401);
});

test("legacy unverified accounts recover only after a correct password", async ({ app, db }) => {
  await post(app.baseUrl, "register", { email, password, ...legalAcceptance });
  const [existing] = await db.update(users).set({ emailVerified: false }).where(eq(users.email, email)).returning();
  await db.insert(emailVerifications).values({
    userId: existing.id,
    tokenHash: createHash("sha256").update("expired-token").digest("hex"),
    expiresAt: new Date(0),
  });
  const rejected = await post(app.baseUrl, "login", { email, password: "incorrect-password" });
  assert.equal(rejected.status, 401);
  assert.equal((await db.select().from(users).where(eq(users.id, existing.id)))[0].emailVerified, false);
  assert.equal((await db.select().from(emailVerifications)).length, 1);
  const accepted = await post(app.baseUrl, "login", { email, password });
  assert.equal(accepted.status, 200);
  const result = await accepted.json();
  assert.equal(result.user.id, existing.id);
  assert.equal(result.user.emailVerified, true);
  assert.equal((await db.select().from(emailVerifications)).length, 0);
  const [persisted] = await db.select().from(users).where(eq(users.id, existing.id));
  assert.equal(persisted.emailVerified, true);
  assert.equal(persisted.passwordHash, existing.passwordHash);
});

test("standard mode retains email verification even with a client-supplied local mode", async ({ app, db }) => {
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standard");
  const mail = vi.spyOn(emailService, "sendVerificationEmail").mockResolvedValue(undefined);
  const response = await post(app.baseUrl, "register", { email, password, ...legalAcceptance, deploymentMode: "standalone" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.emailVerified, false);
  assert.equal(mail.mock.calls.length, 1);
  assert.equal((await db.select().from(emailVerifications)).length, 1);
  const signedIn = await post(app.baseUrl, "login", { email, password, deploymentMode: "standalone" });
  assert.equal(signedIn.status, 200);
  assert.equal((await signedIn.json()).user.emailVerified, false);
  const invalidToken = await post(app.baseUrl, "verify-email", { token: "invalid" });
  assert.equal(invalidToken.status, 400);
});

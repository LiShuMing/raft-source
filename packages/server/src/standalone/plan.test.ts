import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { messages, servers } from "../db/schema";
import { dbTest } from "../test/integration/dbTest";
import { installRisingWaveReadReferences, uninstallRisingWaveReadReferences } from "../test/risingWaveReadReference";
import { getBillingSummary } from "../services/billingService";
import { getUnreadCounts } from "../services/channelService";
import { getFileUploadQuotaSummary } from "../services/fileUploadQuotaService";
import {
  getHistoryCutoff,
  getServerBillingEntitlement,
  getServerPlan,
  requireTeamBillingFeature,
} from "../services/planService";
import { createServer, getServer, getServerBySlug, getUserServers } from "../services/serverService";
import {
  ensureStandaloneServerPlans,
  resolveEffectiveStandalonePlan,
  STANDALONE_SERVER_PLAN,
} from "./plan";

const POST_TRIAL_NOW = new Date("2026-11-23T00:00:00Z");

beforeEach(() => {
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standalone");
});

afterEach(() => {
  vi.unstubAllEnvs();
  installRisingWaveReadReferences();
});

test("resolveEffectiveStandalonePlan promotes free only in standalone mode", () => {
  assert.equal(resolveEffectiveStandalonePlan("free", { RAFT_DEPLOYMENT_MODE: "standalone" }), STANDALONE_SERVER_PLAN);
  assert.equal(resolveEffectiveStandalonePlan("partner", { RAFT_DEPLOYMENT_MODE: "standalone" }), "partner");
  assert.equal(resolveEffectiveStandalonePlan("pro", { RAFT_DEPLOYMENT_MODE: "standalone" }), "pro");
  assert.equal(resolveEffectiveStandalonePlan("free", { RAFT_DEPLOYMENT_MODE: "standard" }), "free");
});

test("getHistoryCutoff removes the 30-day cutoff in standalone mode and preserves it in standard mode", () => {
  assert.equal(getHistoryCutoff("free", POST_TRIAL_NOW), undefined);

  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standard");
  const standardCutoff = getHistoryCutoff("free", POST_TRIAL_NOW);
  assert.ok(standardCutoff instanceof Date);
  assert.equal(Math.round((POST_TRIAL_NOW.getTime() - standardCutoff.getTime()) / 86_400_000), 30);
});

dbTest("standalone creates workspaces on the unlimited founder plan while standard stays free", async ({ seed }) => {
  const owner = await seed.human();

  const standaloneServer = await createServer("Standalone Team", "standalone-team", owner.id);
  assert.equal(standaloneServer.plan, STANDALONE_SERVER_PLAN);

  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standard");
  const standardServer = await createServer("Standard Team", "standard-team", owner.id);
  assert.equal(standardServer.plan, "free");
});

dbTest("ensureStandaloneServerPlans upgrades existing free workspaces and unlocks full history and features", async ({ seed, db }) => {
  uninstallRisingWaveReadReferences();
  const owner = await seed.human();
  const peer = await seed.human();
  const server = await seed.server({ owner, members: [peer] });
  const deletedServer = await seed.server({ owner });

  await db
    .update(servers)
    .set({ plan: "free", planDowngradedAt: new Date("2026-10-01T00:00:00Z") })
    .where(eq(servers.id, server.id));
  await db
    .update(servers)
    .set({ plan: "free", deletedAt: new Date("2026-10-01T00:00:00Z") })
    .where(eq(servers.id, deletedServer.id));

  // Standard mode must never rewrite stored server plans.
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standard");
  assert.equal(await ensureStandaloneServerPlans(db), 0);
  const [stillFree] = await db.select({ plan: servers.plan }).from(servers).where(eq(servers.id, server.id));
  assert.equal(stillFree.plan, "free");

  // Standalone mode upgrades active free workspaces and clears downgrade state.
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standalone");
  assert.equal(await ensureStandaloneServerPlans(db), 1);

  const [upgradedRow] = await db
    .select({ plan: servers.plan, planDowngradedAt: servers.planDowngradedAt })
    .from(servers)
    .where(eq(servers.id, server.id));
  assert.equal(upgradedRow.plan, STANDALONE_SERVER_PLAN);
  assert.equal(upgradedRow.planDowngradedAt, null);

  const [deletedRow] = await db
    .select({ plan: servers.plan })
    .from(servers)
    .where(eq(servers.id, deletedServer.id));
  assert.equal(deletedRow.plan, "free");

  // Full entitlement, unlimited uploads, Pro features, and server projections.
  assert.equal(await getServerPlan(server.id), STANDALONE_SERVER_PLAN);
  const entitlement = await getServerBillingEntitlement(db, server.id, POST_TRIAL_NOW);
  assert.equal(entitlement.plan, STANDALONE_SERVER_PLAN);
  assert.deepEqual(entitlement.capacity, { maxHumans: -1, maxAgents: -1, maxUniversalSeats: -1 });

  const uploadQuota = await getFileUploadQuotaSummary(server.id, POST_TRIAL_NOW);
  assert.equal(uploadQuota.limited, false);
  assert.equal(uploadQuota.enforced, false);
  assert.equal(uploadQuota.limitBytes, -1);

  await assert.doesNotReject(() => requireTeamBillingFeature(db, server.id, "Agent migration", POST_TRIAL_NOW));

  const summary = await getBillingSummary(server.id);
  assert.equal(summary.plan, STANDALONE_SERVER_PLAN);
  assert.equal(summary.serverPlan, STANDALONE_SERVER_PLAN);

  assert.equal((await getServer(server.id))?.plan, STANDALONE_SERVER_PLAN);
  assert.equal((await getServerBySlug(server.slug))?.plan, STANDALONE_SERVER_PLAN);
  const userServers = await getUserServers(owner.id);
  assert.equal(userServers.find((entry) => entry.id === server.id)?.plan, STANDALONE_SERVER_PLAN);

  // Messages older than 30 days remain eligible in PostgreSQL unread queries.
  const channel = await seed.channel({ server, members: [owner, peer], name: "archive-room" });
  const oldMessage = await seed.message({ channel, author: peer, content: "Message from 45 days ago" });
  await db
    .update(messages)
    .set({ createdAt: new Date(Date.now() - 45 * 86_400_000) })
    .where(eq(messages.id, oldMessage.id));
  assert.equal((await getUnreadCounts(server.id, owner.id))[channel.id], 1);
});

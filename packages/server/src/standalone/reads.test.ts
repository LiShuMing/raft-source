import assert from "node:assert/strict";
import { vi } from "vitest";
import { agents } from "../db/schema";
import { dbTest } from "../test/integration/dbTest";
import { installRisingWaveReadReferences, uninstallRisingWaveReadReferences } from "../test/risingWaveReadReference";
import { getActivityReadSource } from "../services/activityReadSource";
import { getConversationUnreadSource } from "../services/conversationUnreadSource";
import {
  addAgent,
  getAgentUnreadCounts,
  getInboxItems,
  getUnreadCounts,
  listAgentInbox,
  markRead,
  selectAgentInboxChainRows,
} from "../services/channelService";

beforeEach(() => {
  uninstallRisingWaveReadReferences();
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standalone");
});

afterEach(() => {
  vi.unstubAllEnvs();
  installRisingWaveReadReferences();
});

test("standard mode never silently substitutes a local backend", () => {
  vi.stubEnv("RAFT_DEPLOYMENT_MODE", "standard");
  assert.equal(getActivityReadSource(), null);
  assert.equal(getConversationUnreadSource(), null);
});

dbTest("standalone reads real persisted messages without test source overrides or RisingWave", async ({ seed, db }) => {
  const owner = await seed.human();
  const peer = await seed.human();
  const server = await seed.server({ owner, members: [peer] });
  const channel = await seed.channel({ server, members: [owner, peer], name: "local-room" });
  const [agent] = await db.insert(agents).values({ serverId: server.id, name: "engineer", status: "active" }).returning();
  await addAgent(channel.id, agent.id);
  const message = await seed.message({ channel, author: peer, content: "Please investigate" });

  assert.equal((await getUnreadCounts(server.id, owner.id))[channel.id], 1);
  await getInboxItems(server.id, owner.id, { filter: "all" });
  const selection = await selectAgentInboxChainRows(agent.id);
  assert.equal(selection.source, "chain");
  assert.ok(selection.source === "chain");
  assert.equal((await getAgentUnreadCounts(agent.id, selection.rows))["#local-room"], 1);
  const inbox = await listAgentInbox(agent.id, server.id, { view: "unread", limit: 10 });
  assert.equal(inbox.totals.conversations, 1);
  assert.equal(inbox.items.length, 1);

  await markRead(owner.id, channel.id, message.seq);
  assert.equal((await getUnreadCounts(server.id, owner.id))[channel.id] ?? 0, 0);
});

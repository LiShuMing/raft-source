import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { apiTest } from "../test/integration/apiTest";
import {
  agents,
  channelAgents,
  channelHumans,
  channels,
  personalRoutineRuns,
  personalRoutines,
  tasks,
} from "../db/schema";
import { personalMessageContext } from "../services/personalWorkspaceService";
import { collectPersonalRoutineOccurrences } from "../services/personalRoutineWorker";

async function json(response: Response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}
const body = (data: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

apiTest(
  "personal DM task reads preserve channel membership and space boundaries",
  async ({ db, seed, http }) => {
    const owner = await seed.human(),
      other = await seed.human();
    const server = await seed.server({ owner, members: [other] });
    const [agent] = await db
      .insert(agents)
      .values({
        serverId: server.id,
        name: "personal-reader",
        runtime: "external",
        creatorType: "user",
        creatorId: owner.id,
      })
      .returning();
    const [dm] = await db
      .insert(channels)
      .values({ serverId: server.id, name: "private-dm", type: "dm" })
      .returning();
    await db
      .insert(channelHumans)
      .values({ channelId: dm!.id, userId: owner.id });
    await db
      .insert(channelAgents)
      .values({ channelId: dm!.id, agentId: agent!.id });
    await db
      .insert(tasks)
      .values({
        channelId: dm!.id,
        taskNumber: 1,
        title: "private task",
        createdByType: "user",
        createdById: owner.id,
      });
    const mine = await json(
      await http.as(owner, server).get("/api/personal/overview"),
    );
    assert.equal(mine.tasks.length, 1);
    assert.equal(mine.tasks[0].agentId, agent!.id);
    const theirs = await json(
      await http.as(other, server).get("/api/personal/overview"),
    );
    assert.deepEqual(theirs.tasks, []);
    await json(await http.as(owner).get("/api/personal/overview"), 400);
    await seed.message({
      channel: dm!,
      author: owner,
      content: "secret-search-marker",
    });
    const hits = await json(
      await http
        .as(owner, server)
        .get("/api/personal/search/messages?q=secret-search-marker"),
    );
    assert.equal(hits.messages.length, 1);
    assert.equal(
      (
        await json(
          await http
            .as(other, server)
            .get("/api/personal/search/messages?q=secret-search-marker"),
        )
      ).messages.length,
      0,
    );
    await json(
      await http.as(owner, server).get("/api/personal/search/messages?q=x"),
      400,
    );
  },
);

apiTest(
  "platform memory is versioned, private and removed from subsequent context on disable",
  async ({ db, seed, http, app }) => {
    const owner = await seed.human(),
      other = await seed.human();
    const server = await seed.server({ owner, members: [other] });
    const [agent] = await db
      .insert(agents)
      .values({
        serverId: server.id,
        name: "memory-reader",
        runtime: "external",
        creatorType: "user",
        creatorId: owner.id,
      })
      .returning();
    const [dm] = await db
      .insert(channels)
      .values({ serverId: server.id, name: "memory-dm", type: "dm" })
      .returning();
    await db
      .insert(channelHumans)
      .values({ channelId: dm!.id, userId: owner.id });
    await db
      .insert(channelAgents)
      .values({ channelId: dm!.id, agentId: agent!.id });
    const c = http.as(owner, server),
      id = randomUUID();
    const input = {
      id,
      agentId: agent!.id,
      kind: "memory",
      title: "sources",
      content: "Use official sources",
      enabled: true,
    };
    const { resource } = await json(
      await c.request("/api/personal/resources", body(input)),
      201,
    );
    await json(await c.request("/api/personal/resources", body(input)), 201);
    await json(
      await c.request(
        "/api/personal/resources",
        body({ ...input, enabled: false }),
      ),
      409,
    );
    assert.ok(
      (await personalMessageContext(dm!.id, owner.id, "research")).includes(
        "Use official sources",
      ),
    );
    let delivered = "";
    app.app.get("agentOrchestrator").deliverMessage = async (
      _id: string,
      message: { content: string },
    ) => {
      delivered = message.content;
    };
    await json(
      await c.request(
        "/api/v2/messages",
        body({
          channelId: dm!.id,
          content: "context integration check",
          personalContext: true,
        }),
      ),
    );
    assert.ok(
      delivered.includes("Use official sources"),
      "the real message API must deliver platform context to the runtime",
    );
    const { mintAgentCredential } = await import(
      "../services/agentCredentialService"
    );
    const credential = await mintAgentCredential({
      agentId: agent!.id,
      scopes: ["read"],
      name: "personal-context-test",
      createdByUserId: owner.id,
    });
    const readHistory = () =>
      fetch(
        `${app.baseUrl}/internal/agent-api/history?channel=${encodeURIComponent(`dm:@${owner.name}`)}`,
        { headers: { Authorization: `Bearer ${credential.apiKey}` } },
      );
    const historyBefore = await json(await readHistory());
    assert.ok(
      historyBefore.messages.some((message: { content: string }) =>
        message.content.includes("Use official sources"),
      ),
      "native CLI history reads must receive current platform memory",
    );

    assert.equal(
      await personalMessageContext(dm!.id, other.id, "research"),
      "",
    );
    await json(
      await http
        .as(other, server)
        .request(
          `/api/personal/resources/${id}`,
          body({ expectedVersion: 1, content: "hijacked" }, "PATCH"),
        ),
      409,
    );
    await json(
      await c.request(
        `/api/personal/resources/${id}`,
        body({ expectedVersion: resource.version, enabled: false }, "PATCH"),
      ),
    );
    assert.equal(
      await personalMessageContext(dm!.id, owner.id, "research"),
      "",
    );
    const historyAfter = await json(await readHistory());
    assert.ok(
      historyAfter.messages.every(
        (message: { content: string }) =>
          !message.content.includes("Use official sources"),
      ),
      "disabled memory must not be injected on later history reads",
    );

    await json(
      await c.request(
        `/api/personal/resources/${id}`,
        body({ expectedVersion: 1, enabled: true }, "PATCH"),
      ),
      409,
    );
    const history = await json(
      await c.get(`/api/personal/resources/${id}/history`),
    );
    assert.equal(history.revisions.length, 2);
  },
);

apiTest(
  "saved artifacts have immutable revisions, real source content and compare-and-swap writes",
  async ({ seed, http }) => {
    const owner = await seed.human(),
      outsider = await seed.human();
    const server = await seed.server({ owner, members: [outsider] });
    const channel = await seed.channel({
      server,
      members: [owner],
      visibility: "private",
    });
    const source = await seed.message({
      channel,
      author: owner,
      content: "# Verified source\nActual persisted content",
    });
    const c = http.as(owner, server),
      id = randomUUID();
    const input = {
      id,
      agentId: null,
      channelId: channel.id,
      title: "report",
      sourceMessageId: source.id,
    };
    await json(await c.request("/api/personal/artifacts", body(input)), 201);
    await json(
      await c.request(
        `/api/personal/artifacts/${id}/revisions`,
        body({
          ...input,
          id: undefined,
          content: "# Revised",
          expectedVersion: 1,
        }),
      ),
    );
    await json(
      await c.request(
        `/api/personal/artifacts/${id}/revisions`,
        body({ ...input, id: undefined, content: "stale", expectedVersion: 1 }),
      ),
      409,
    );
    const result = await json(
      await c.get(`/api/personal/artifacts/${id}/revisions`),
    );
    assert.equal(result.revisions.length, 2);
    assert.equal(result.revisions[1].content, source.content);
    await json(
      await http
        .as(outsider, server)
        .get(`/api/personal/artifacts/${id}/revisions`),
      404,
    );
  },
);

apiTest(
  "routine preview uses the requested time zone and occurrences survive repeated scheduler passes",
  async ({ db, seed, http }) => {
    const owner = await seed.human(),
      server = await seed.server({ owner });
    const c = http.as(owner, server);
    const preview = await json(
      await c.request(
        "/api/personal/routines/preview",
        body({
          schedule: "weekdays",
          time: "09:00",
          timezone: "Asia/Shanghai",
          weekday: 2,
        }),
      ),
    );
    assert.equal(preview.dates.length, 3);
    assert.ok(
      preview.dates.every(
        (d: string) =>
          new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Shanghai",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).format(new Date(d)) === "09:00",
      ),
    );
    await json(
      await c.request(
        "/api/personal/routines/preview",
        body({
          schedule: "daily",
          time: "29:70",
          timezone: "bad-zone",
          weekday: 2,
        }),
      ),
      400,
    );
    const [agent] = await db
      .insert(agents)
      .values({
        serverId: server.id,
        name: "scheduled",
        runtime: "external",
        creatorType: "user",
        creatorId: owner.id,
      })
      .returning();
    const channel = await seed.channel({
      server,
      members: [owner],
      visibility: "private",
    });
    const input = {
      agentId: agent!.id,
      channelId: channel.id,
      title: "daily",
      instruction: "read current sources",
      schedule: "daily",
      time: "09:00",
      timezone: "Asia/Shanghai",
      weekday: 2,
    };
    await json(await c.request("/api/personal/routines", body(input)), 409);
    const now = new Date("2026-10-28T02:00:00Z");
    const [routine] = await db
      .insert(personalRoutines)
      .values({
        ...input,
        schedule: "daily",
        serverId: server.id,
        ownerUserId: owner.id,
        nextRunAt: new Date(now.getTime() - 30_000),
      })
      .returning();
    await collectPersonalRoutineOccurrences(now);
    await collectPersonalRoutineOccurrences(now);
    const runs = await db
      .select()
      .from(personalRoutineRuns)
      .where(eq(personalRoutineRuns.routineId, routine!.id));
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.status, "queued");
  },
);

apiTest(
  "approval binds the exact draft version and concurrent confirmations create one message",
  async ({ db, seed, http }) => {
    const owner = await seed.human(),
      server = await seed.server({ owner });
    const channel = await seed.channel({
      server,
      members: [owner],
      visibility: "private",
    });
    const c = http.as(owner, server),
      id = randomUUID();
    const input = {
      id,
      channelId: channel.id,
      targetChannelId: channel.id,
      title: "draft",
      content: "reviewed content",
    };
    const first = await json(
      await c.request("/api/personal/drafts", body(input)),
      201,
    );
    const second = await json(
      await c.request(
        `/api/personal/drafts/${id}`,
        body(
          {
            ...input,
            id: undefined,
            expectedVersion: 1,
            content: "edited content",
          },
          "PATCH",
        ),
      ),
    );
    await json(
      await c.request(
        `/api/personal/drafts/${id}/decision`,
        body({ version: 1, digest: first.draft.digest, approve: true }),
      ),
      409,
    );
    const response = await Promise.all(
      [1, 2].map(() =>
        c.request(
          `/api/personal/drafts/${id}/decision`,
          body({ version: 2, digest: second.draft.digest, approve: true }),
        ),
      ),
    );
    assert.ok(response.some((r) => r.status === 200));
    assert.ok(response.every((r) => r.status === 200 || r.status === 409));
    const { messages } = await import("../db/schema");
    const sent = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.channelId, channel.id),
          eq(messages.randomId, `personal-draft:${id}:2`),
        ),
      );
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.content, "edited content");
  },
);

apiTest(
  "personal task cursor preserves equal timestamps and rejects malformed cursors",
  async ({ db, seed, http }) => {
    const owner = await seed.human(),
      server = await seed.server({ owner });
    const channel = await seed.channel({
      server,
      members: [owner],
      visibility: "private",
    });
    const at = new Date("2026-10-28T02:00:00Z");
    await db
      .insert(tasks)
      .values(
        Array.from({ length: 65 }, (_, i) => ({
          channelId: channel.id,
          taskNumber: i + 1,
          title: `task-${i}`,
          createdByType: "user" as const,
          createdById: owner.id,
          updatedAt: at,
        })),
      );
    const c = http.as(owner, server);
    const first = await json(await c.get("/api/personal/tasks"));
    assert.equal(first.tasks.length, 60);
    assert.ok(first.nextTaskCursor);
    const second = await json(
      await c.get(
        `/api/personal/tasks?after=${encodeURIComponent(first.nextTaskCursor)}`,
      ),
    );
    assert.equal(second.tasks.length, 5);
    assert.equal(second.nextTaskCursor, null);
    assert.equal(
      new Set([...first.tasks, ...second.tasks].map((t) => t.id)).size,
      65,
    );
    await json(await c.get("/api/personal/tasks?after=malformed"), 400);
  },
);

apiTest(
  "routine skills are immutable snapshots and dispatch receipts require canonical task acceptance",
  async ({ db, seed, http, app }) => {
    const { machines } = await import("../db/schema");
    const { dispatchPersonalRoutineRuns } = await import(
      "../services/personalRoutineWorker"
    );
    const owner = await seed.human(),
      server = await seed.server({ owner });
    const [machine] = await db
      .insert(machines)
      .values({
        serverId: server.id,
        userId: owner.id,
        name: "test computer",
        apiKeyHash: "test-only",
      })
      .returning();
    const [agent] = await db
      .insert(agents)
      .values({
        serverId: server.id,
        name: "scheduled-local",
        runtime: "codex",
        machineId: machine!.id,
        creatorType: "user",
        creatorId: owner.id,
      })
      .returning();
    const channel = await seed.channel({
      server,
      members: [owner],
      visibility: "private",
    });
    await db
      .insert(channelAgents)
      .values({ channelId: channel.id, agentId: agent!.id });
    const c = http.as(owner, server),
      skillId = randomUUID();
    await json(
      await c.request(
        "/api/personal/resources",
        body({
          id: skillId,
          agentId: agent!.id,
          kind: "skill",
          title: "read-only",
          content: "original skill",
          enabled: true,
        }),
      ),
      201,
    );
    const input = {
      agentId: agent!.id,
      channelId: channel.id,
      title: "check",
      instruction: "read current files",
      schedule: "daily",
      time: "09:00",
      timezone: "Asia/Shanghai",
      weekday: 2,
      enabled: true,
      skillId,
    };
    const createId = randomUUID();
    const { routine } = await json(
      await c.request(
        "/api/personal/routines",
        body({ ...input, id: createId }),
      ),
      201,
    );
    await json(
      await c.request(
        "/api/personal/routines",
        body({ ...input, id: createId }),
      ),
      201,
    );
    await json(
      await c.request(
        "/api/personal/routines",
        body({ ...input, id: createId, time: "10:00" }),
      ),
      409,
    );
    const updated = await json(
      await c.request(
        `/api/personal/routines/${routine.id}`,
        body({ ...input, expectedVersion: 1 }, "PATCH"),
      ),
    );
    assert.equal(
      updated.routine.instruction,
      input.instruction,
      "editing must not append the skill repeatedly",
    );
    await json(
      await c.request(
        `/api/personal/resources/${skillId}`,
        body({ expectedVersion: 1, content: "changed skill" }, "PATCH"),
      ),
    );
    const requestId = randomUUID();
    await json(
      await c.request(
        `/api/personal/routines/${routine.id}/test`,
        body({ requestId }),
      ),
      202,
    );
    await json(
      await c.request(
        `/api/personal/routines/${routine.id}/test`,
        body({ requestId }),
      ),
      202,
    );
    let runs = await db
      .select()
      .from(personalRoutineRuns)
      .where(eq(personalRoutineRuns.routineId, routine.id));
    assert.equal(runs.length, 1);
    assert.ok(runs[0]!.instruction.includes("original skill"));
    assert.ok(!runs[0]!.instruction.includes("changed skill"));
    const orchestrator = app.app.get("agentOrchestrator");
    await dispatchPersonalRoutineRuns(app.io, orchestrator);
    runs = await db
      .select()
      .from(personalRoutineRuns)
      .where(eq(personalRoutineRuns.routineId, routine.id));
    assert.equal(runs[0]!.status, "queued");
    assert.equal(runs[0]!.errorCode, "waiting_for_computer");
    orchestrator.getMachineStatus = async () => "online";
    await dispatchPersonalRoutineRuns(app.io, orchestrator);
    runs = await db
      .select()
      .from(personalRoutineRuns)
      .where(eq(personalRoutineRuns.routineId, routine.id));
    assert.equal(runs[0]!.status, "dispatched");
    assert.ok(runs[0]!.messageId);
    await dispatchPersonalRoutineRuns(app.io, orchestrator);
    assert.equal(
      (
        await db
          .select()
          .from(personalRoutineRuns)
          .where(eq(personalRoutineRuns.id, requestId))
      )[0]!.status,
      "dispatched",
    );
    await db
      .update(tasks)
      .set({ status: "done" })
      .where(eq(tasks.messageId, runs[0]!.messageId!));
    await dispatchPersonalRoutineRuns(app.io, orchestrator);
    assert.equal(
      (
        await db
          .select()
          .from(personalRoutineRuns)
          .where(eq(personalRoutineRuns.id, requestId))
      )[0]!.status,
      "completed",
    );
    const staleTestId = randomUUID();
    await json(
      await c.request(
        `/api/personal/routines/${routine.id}/test`,
        body({ requestId: staleTestId }),
      ),
      202,
    );
    await json(
      await c.request(
        `/api/personal/routines/${routine.id}`,
        body({ expectedVersion: 2, enabled: false }, "PATCH"),
      ),
    );
    await dispatchPersonalRoutineRuns(app.io, orchestrator);
    const [staleTest] = await db
      .select()
      .from(personalRoutineRuns)
      .where(eq(personalRoutineRuns.id, staleTestId));
    assert.equal(staleTest!.status, "missed");
    assert.equal(staleTest!.errorCode, "schedule_changed");
  },
);

apiTest(
  "expired and revoked drafts cannot send, and missed or overlapping routine slots do not queue",
  async ({ db, seed, http }) => {
    const { personalDrafts, messages } = await import("../db/schema");
    const owner = await seed.human(),
      server = await seed.server({ owner });
    const channel = await seed.channel({
      server,
      members: [owner],
      visibility: "private",
    });
    const c = http.as(owner, server),
      id = randomUUID();
    const { draft } = await json(
      await c.request(
        "/api/personal/drafts",
        body({
          id,
          channelId: channel.id,
          targetChannelId: channel.id,
          title: "expires",
          content: "must not send",
        }),
      ),
      201,
    );
    await db
      .update(personalDrafts)
      .set({ expiresAt: new Date(0) })
      .where(eq(personalDrafts.id, id));
    await json(
      await c.request(
        `/api/personal/drafts/${id}/decision`,
        body({ version: 1, digest: draft.digest, approve: true }),
      ),
      410,
    );
    assert.equal(
      (
        await db
          .select()
          .from(messages)
          .where(eq(messages.randomId, `personal-draft:${id}:1`))
      ).length,
      0,
    );
    const [agent] = await db
      .insert(agents)
      .values({
        serverId: server.id,
        name: "missed-check",
        runtime: "external",
        creatorType: "user",
        creatorId: owner.id,
      })
      .returning();
    const now = new Date("2026-10-28T02:00:00Z");
    const [routine] = await db
      .insert(personalRoutines)
      .values({
        serverId: server.id,
        ownerUserId: owner.id,
        agentId: agent!.id,
        channelId: channel.id,
        title: "missed",
        instruction: "read",
        schedule: "daily",
        time: "09:00",
        timezone: "Asia/Shanghai",
        nextRunAt: new Date(now.getTime() - 3 * 3600_000),
      })
      .returning();
    await collectPersonalRoutineOccurrences(now);
    let runs = await db
      .select()
      .from(personalRoutineRuns)
      .where(eq(personalRoutineRuns.routineId, routine!.id));
    assert.equal(runs[0]!.status, "missed");
    assert.equal(runs[0]!.errorCode, "catchup_window_expired");
    await db
      .insert(personalRoutineRuns)
      .values({
        routineId: routine!.id,
        scheduleVersion: 1,
        scheduledFor: now,
        instruction: "previous",
        trigger: "test",
        status: "dispatched",
      });
    await db
      .update(personalRoutines)
      .set({ nextRunAt: new Date(now.getTime() - 1000) })
      .where(eq(personalRoutines.id, routine!.id));
    await collectPersonalRoutineOccurrences(now);
    runs = await db
      .select()
      .from(personalRoutineRuns)
      .where(eq(personalRoutineRuns.routineId, routine!.id));
    assert.ok(
      runs.some(
        (r) => r.status === "missed" && r.errorCode === "previous_run_active",
      ),
    );
    assert.equal(runs.filter((r) => r.status === "queued").length, 0);
    await db
      .delete(channelHumans)
      .where(
        and(
          eq(channelHumans.channelId, channel.id),
          eq(channelHumans.userId, owner.id),
        ),
      );
    await json(
      await c.request(
        `/api/personal/drafts/${id}/decision`,
        body({ version: 1, digest: draft.digest, approve: true }),
      ),
      404,
    );
  },
);

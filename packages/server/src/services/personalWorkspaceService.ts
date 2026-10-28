import { createHash, randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../db/index";
import {
  agents,
  channelAgents,
  channelHumans,
  channels,
  messages,
  tasks,
  users,
  personalArtifacts,
  personalArtifactRevisions,
  personalResources,
  personalResourceRevisions,
  personalRoutines,
  personalRoutineRuns,
  personalDrafts,
  personalGroups,
  personalPreferences,
} from "../db/schema";
import * as channelService from "./channelService";
import {
  actorHasServerCapabilityInServer,
  getActorServerRoleInServer,
} from "../lib/actorPermissions";
import {
  computeNextFire,
  type Recurrence,
  type Weekday,
  WEEKDAY_ORDER,
} from "./recurrence";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { asServerId } from "@botiverse/raft-shared";
import type { PersonalSnapshot, PersonalRoutine } from "@botiverse/raft-shared";
import type { Server as SocketServer } from "socket.io";
import type { AgentOrchestrator } from "./agentOrchestrator";

export interface PersonalScope {
  serverId: string;
  userId: string;
}
export class PersonalError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const personalNotFound = () =>
  new PersonalError(404, "personal_not_found", "Object not found");
export const personalConflict = () =>
  new PersonalError(
    409,
    "personal_version_conflict",
    "This object changed. Refresh before applying your changes.",
  );
const digest = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const owned = (
  table: { serverId: AnyPgColumn; ownerUserId: AnyPgColumn },
  scope: PersonalScope,
) =>
  and(eq(table.serverId, scope.serverId), eq(table.ownerUserId, scope.userId));

/** Every read and dispatch revalidates membership; a persisted owner id is not a standing grant. */
export async function assertPersonalMember(scope: PersonalScope) {
  const role = await getActorServerRoleInServer(
    scope.serverId,
    "user",
    scope.userId,
  );
  if (!role || role === "guest") throw personalNotFound();
}
export async function assertPersonalAgent(
  scope: PersonalScope,
  id: string,
  executor: DatabaseExecutor = getDb(),
) {
  const [agent] = await executor
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, id),
        eq(agents.serverId, scope.serverId),
        isNull(agents.deletedAt),
      ),
    )
    .limit(1);
  if (!agent) throw personalNotFound();
  const creator =
    agent.creatorType === "user" && agent.creatorId === scope.userId;
  if (
    !creator &&
    !(await actorHasServerCapabilityInServer(
      scope.serverId,
      "user",
      scope.userId,
      "editAgents",
    ))
  )
    throw personalNotFound();
  return agent;
}
export async function assertPersonalChannel(
  scope: PersonalScope,
  id: string,
  write = false,
) {
  const [channel] = await getDb()
    .select()
    .from(channels)
    .where(
      and(
        eq(channels.id, id),
        eq(channels.serverId, scope.serverId),
        isNull(channels.deletedAt),
      ),
    )
    .limit(1);
  if (
    !channel ||
    !(await channelService.canUserAccessChannel(
      id,
      scope.userId,
      asServerId(scope.serverId),
    ))
  )
    throw personalNotFound();
  if (write) {
    const [membership] = await getDb()
      .select({ id: channelHumans.userId })
      .from(channelHumans)
      .where(
        and(
          eq(channelHumans.channelId, id),
          eq(channelHumans.userId, scope.userId),
        ),
      )
      .limit(1);
    if (!membership || channel.archivedAt || channel.type === "joint")
      throw new PersonalError(
        403,
        "personal_channel_read_only",
        "This conversation is not writable",
      );
  }
  return channel;
}
async function readSource(
  scope: PersonalScope,
  messageId: string,
  channelId?: string,
) {
  const [row] = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!row || (channelId && row.channelId !== channelId))
    throw personalNotFound();
  await assertPersonalChannel(scope, row.channelId);
  return row;
}
function serialize<T>(row: T): T {
  return JSON.parse(JSON.stringify(row)) as T;
}

export async function searchPersonalMessages(
  scope: PersonalScope,
  query: string,
) {
  const candidate = await getDb()
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(channelHumans, eq(channelHumans.channelId, channels.id))
    .where(
      and(
        eq(channels.serverId, scope.serverId),
        eq(channelHumans.userId, scope.userId),
        isNull(channels.deletedAt),
        isNull(channels.archivedAt),
        or(eq(channels.type, "dm"), eq(channels.type, "private")),
      ),
    );
  const visible = await channelService.filterUserAccessibleChannelIds(
    candidate.map((c) => c.id),
    scope.userId,
    asServerId(scope.serverId),
  );
  if (!visible.size) return [];
  const escaped = query.replace(/[\\%_]/g, "\\$&");
  return getDb()
    .select({
      id: messages.id,
      channelId: messages.channelId,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        inArray(messages.channelId, [...visible]),
        ilike(messages.content, `%${escaped}%`),
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(30);
}

export async function listPersonalTasks(
  scope: PersonalScope,
  after?: string,
  limit = 60,
) {
  const db = getDb();
  const candidate = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(channelHumans, eq(channelHumans.channelId, channels.id))
    .where(
      and(
        eq(channels.serverId, scope.serverId),
        eq(channelHumans.userId, scope.userId),
        isNull(channels.deletedAt),
        isNull(channels.archivedAt),
        or(eq(channels.type, "dm"), eq(channels.type, "private")),
      ),
    );
  const visible = await channelService.filterUserAccessibleChannelIds(
    candidate.map((c) => c.id),
    scope.userId,
    asServerId(scope.serverId),
  );
  if (!visible.size) return { tasks: [], nextTaskCursor: null };
  const conditions: (SQL | undefined)[] = [
    inArray(tasks.channelId, [...visible]),
  ];
  if (after) {
    let value: { at?: string; id?: string };
    try {
      value = JSON.parse(Buffer.from(after, "base64url").toString());
    } catch {
      throw new PersonalError(400, "invalid_cursor", "Invalid task cursor");
    }
    if (
      !value.at ||
      !value.id ||
      !Number.isFinite(Date.parse(value.at)) ||
      !/^[0-9a-f-]{36}$/i.test(value.id)
    )
      throw new PersonalError(400, "invalid_cursor", "Invalid task cursor");
    conditions.push(
      or(
        lt(tasks.updatedAt, new Date(value.at)),
        and(eq(tasks.updatedAt, new Date(value.at)), lt(tasks.id, value.id)),
      ),
    );
  }
  const rows = await db
    .select({ task: tasks, channelName: channels.name })
    .from(tasks)
    .innerJoin(channels, eq(tasks.channelId, channels.id))
    .where(and(...conditions))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const agentRows = await db
    .select({
      channelId: channelAgents.channelId,
      agentId: channelAgents.agentId,
    })
    .from(channelAgents)
    .where(inArray(channelAgents.channelId, [...visible]));
  const last = page.at(-1)?.task;
  return {
    tasks: page.map(({ task: t, channelName }) => ({
      id: t.id,
      messageId: t.messageId,
      channelId: t.channelId,
      channelName,
      agentId:
        t.claimedByType === "agent"
          ? t.claimedById
          : (agentRows.find((a) => a.channelId === t.channelId)?.agentId ??
            null),
      title: t.title,
      status: t.status,
      revision: t.revision,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
    nextTaskCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({ at: last.updatedAt.toISOString(), id: last.id }),
          ).toString("base64url")
        : null,
  };
}

export async function getPersonalSnapshot(
  scope: PersonalScope,
): Promise<PersonalSnapshot> {
  const db = getDb();
  const [
    resources,
    artifacts,
    routines,
    drafts,
    groups,
    preferences,
    taskPage,
  ] = await Promise.all([
    db
      .select()
      .from(personalResources)
      .where(owned(personalResources, scope))
      .orderBy(desc(personalResources.updatedAt)),
    db
      .select()
      .from(personalArtifacts)
      .where(owned(personalArtifacts, scope))
      .orderBy(desc(personalArtifacts.updatedAt)),
    db
      .select()
      .from(personalRoutines)
      .where(owned(personalRoutines, scope))
      .orderBy(desc(personalRoutines.updatedAt)),
    db
      .select()
      .from(personalDrafts)
      .where(owned(personalDrafts, scope))
      .orderBy(desc(personalDrafts.updatedAt))
      .limit(100),
    db
      .select()
      .from(personalGroups)
      .where(owned(personalGroups, scope))
      .orderBy(desc(personalGroups.createdAt)),
    db
      .select()
      .from(personalPreferences)
      .where(
        and(
          eq(personalPreferences.serverId, scope.serverId),
          eq(personalPreferences.userId, scope.userId),
        ),
      )
      .limit(1),
    listPersonalTasks(scope),
  ]);
  // Ownership does not bypass current channel/agent visibility after removal or archival.
  const channelIds = [
    ...new Set([
      ...artifacts.map((a) => a.channelId),
      ...routines.map((r) => r.channelId),
      ...drafts.flatMap((d) => [d.channelId, d.targetChannelId]),
      ...groups.map((g) => g.channelId),
    ]),
  ];
  const visible = await channelService.filterUserAccessibleChannelIds(
    channelIds,
    scope.userId,
    asServerId(scope.serverId),
  );
  const now = new Date();
  await db
    .update(personalDrafts)
    .set({ state: "expired", updatedAt: now })
    .where(
      and(
        owned(personalDrafts, scope),
        eq(personalDrafts.state, "pending"),
        lt(personalDrafts.expiresAt, now),
      ),
    );
  return serialize({
    resources,
    artifacts: artifacts.filter((a) => visible.has(a.channelId)),
    routines: routines.filter((r) => visible.has(r.channelId)),
    drafts: drafts
      .filter((d) => visible.has(d.channelId) && visible.has(d.targetChannelId))
      .map((d) =>
        d.state === "pending" && d.expiresAt < now
          ? { ...d, state: "expired" as const }
          : d,
      ),
    groups: groups.filter((g) => visible.has(g.channelId)),
    preferences: preferences[0]?.value ?? {},
    ...taskPage,
  }) as unknown as PersonalSnapshot;
}

export interface ResourceInput {
  id?: string;
  agentId: string | null;
  kind: "memory" | "skill";
  title: string;
  content: string;
  enabled: boolean;
  sourceMessageId?: string | null;
}
export async function createPersonalResource(
  scope: PersonalScope,
  input: ResourceInput,
) {
  if (input.agentId) await assertPersonalAgent(scope, input.agentId);
  if (input.sourceMessageId) await readSource(scope, input.sourceMessageId);
  const id = input.id ?? randomUUID();
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(personalResources)
      .values({
        ...input,
        id,
        ...{ serverId: scope.serverId, ownerUserId: scope.userId },
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      const [existing] = await tx
        .select()
        .from(personalResources)
        .where(
          and(owned(personalResources, scope), eq(personalResources.id, id)),
        );
      if (!existing) throw personalNotFound();
      if (
        existing.content !== input.content ||
        existing.title !== input.title ||
        existing.agentId !== input.agentId ||
        existing.kind !== input.kind ||
        existing.enabled !== input.enabled ||
        existing.sourceMessageId !== (input.sourceMessageId ?? null)
      )
        throw personalConflict();
      return existing;
    }
    await tx
      .insert(personalResourceRevisions)
      .values({
        resourceId: id,
        version: row.version,
        title: row.title,
        content: row.content,
        enabled: row.enabled,
      });
    return row;
  });
}
export async function updatePersonalResource(
  scope: PersonalScope,
  id: string,
  expectedVersion: number,
  patch: { title?: string; content?: string; enabled?: boolean },
) {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(personalResources)
      .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
      .where(
        and(
          owned(personalResources, scope),
          eq(personalResources.id, id),
          eq(personalResources.version, expectedVersion),
        ),
      )
      .returning();
    if (!row) throw personalConflict();
    await tx
      .insert(personalResourceRevisions)
      .values({
        resourceId: id,
        version: row.version,
        title: row.title,
        content: row.content,
        enabled: row.enabled,
      });
    return row;
  });
}

export interface ArtifactInput {
  id?: string;
  channelId: string;
  agentId: string | null;
  title: string;
  content?: string;
  sourceMessageId?: string | null;
}
export async function savePersonalArtifact(
  scope: PersonalScope,
  input: ArtifactInput,
  existing?: { id: string; expectedVersion: number },
) {
  await assertPersonalChannel(scope, input.channelId);
  if (input.agentId) await assertPersonalAgent(scope, input.agentId);
  const source = input.sourceMessageId
    ? await readSource(scope, input.sourceMessageId, input.channelId)
    : null;
  const content = input.content ?? source?.content;
  if (!content?.trim() || content.length > 250_000)
    throw new PersonalError(
      400,
      "invalid_artifact",
      "Choose a non-empty result of at most 250,000 characters",
    );
  return getDb().transaction(async (tx) => {
    let row;
    if (existing) {
      [row] = await tx
        .update(personalArtifacts)
        .set({
          title: input.title,
          sourceMessageId: input.sourceMessageId ?? null,
          version: existing.expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            owned(personalArtifacts, scope),
            eq(personalArtifacts.id, existing.id),
            eq(personalArtifacts.channelId, input.channelId),
            eq(personalArtifacts.version, existing.expectedVersion),
          ),
        )
        .returning();
      if (!row) throw personalConflict();
    } else {
      const id = input.id ?? randomUUID();
      [row] = await tx
        .insert(personalArtifacts)
        .values({
          id,
          serverId: scope.serverId,
          ownerUserId: scope.userId,
          agentId: input.agentId,
          channelId: input.channelId,
          sourceMessageId: input.sourceMessageId ?? null,
          title: input.title,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        const [previous] = await tx
          .select()
          .from(personalArtifacts)
          .where(
            and(owned(personalArtifacts, scope), eq(personalArtifacts.id, id)),
          );
        const [revision] = await tx
          .select()
          .from(personalArtifactRevisions)
          .where(
            and(
              eq(personalArtifactRevisions.artifactId, id),
              eq(personalArtifactRevisions.revision, 1),
            ),
          );
        if (
          !previous ||
          !revision ||
          revision.digest !== digest(content) ||
          previous.title !== input.title ||
          previous.channelId !== input.channelId ||
          previous.agentId !== input.agentId ||
          previous.sourceMessageId !== (input.sourceMessageId ?? null)
        )
          throw personalConflict();
        return previous;
      }
    }
    await tx
      .insert(personalArtifactRevisions)
      .values({
        artifactId: row.id,
        revision: row.version,
        content,
        digest: digest(content),
        sourceMessageId: input.sourceMessageId ?? null,
      });
    return row;
  });
}
export async function getPersonalArtifactRevisions(
  scope: PersonalScope,
  id: string,
) {
  const [artifact] = await getDb()
    .select()
    .from(personalArtifacts)
    .where(and(owned(personalArtifacts, scope), eq(personalArtifacts.id, id)));
  if (!artifact) throw personalNotFound();
  await assertPersonalChannel(scope, artifact.channelId);
  const revisions = await getDb()
    .select()
    .from(personalArtifactRevisions)
    .where(eq(personalArtifactRevisions.artifactId, id))
    .orderBy(desc(personalArtifactRevisions.revision));
  return { artifact, revisions };
}

type RoutineInput = Pick<
  PersonalRoutine,
  | "agentId"
  | "channelId"
  | "title"
  | "instruction"
  | "schedule"
  | "time"
  | "timezone"
  | "weekday"
> & { id?: string; enabled?: boolean; skillId?: string | null };
export function personalRecurrence(
  input: Pick<RoutineInput, "schedule" | "time" | "timezone" | "weekday">,
): Recurrence {
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format();
  } catch {
    throw new PersonalError(
      400,
      "invalid_timezone",
      "Choose a valid IANA time zone",
    );
  }
  const match = /^(\d{2}):(\d{2})$/.exec(input.time);
  if (!match || +match[1]! > 23 || +match[2]! > 59)
    throw new PersonalError(400, "invalid_time", "Use a valid HH:MM time");
  const hm = {
    hour: Number(match[1]),
    minute: Number(match[2]),
    tz: input.timezone,
  };
  if (input.schedule === "daily")
    return { version: 1, rule: { kind: "daily", ...hm } };
  const days =
    input.schedule === "weekdays"
      ? (["mon", "tue", "wed", "thu", "fri"] as Weekday[])
      : [WEEKDAY_ORDER[input.weekday]!];
  if (days.some((d) => !d))
    throw new PersonalError(400, "invalid_weekday", "Choose a weekday");
  return { version: 1, rule: { kind: "weekly", days, ...hm } };
}
export function previewPersonalRoutine(
  input: Pick<RoutineInput, "schedule" | "time" | "timezone" | "weekday">,
  now = new Date(),
) {
  const recurrence = personalRecurrence(input);
  const dates: string[] = [];
  let next = now;
  for (let i = 0; i < 3; i++) {
    next = computeNextFire(recurrence, next);
    dates.push(next.toISOString());
  }
  return dates;
}
export async function savePersonalRoutine(
  scope: PersonalScope,
  input: RoutineInput,
  existing?: { id: string; expectedVersion: number },
) {
  const agent = await assertPersonalAgent(scope, input.agentId);
  if (!agent.machineId || agent.runtime === "external")
    throw new PersonalError(
      409,
      "routine_execution_missing",
      "Select an agent with an execution computer before enabling scheduled work",
    );
  await assertPersonalChannel(scope, input.channelId, true);
  const [member] = await getDb()
    .select()
    .from(channelAgents)
    .where(
      and(
        eq(channelAgents.channelId, input.channelId),
        eq(channelAgents.agentId, input.agentId),
      ),
    )
    .limit(1);
  if (!member) throw personalNotFound();
  let skillVersion: number | null = null;
  let skillSnapshot: string | null = null;
  if (input.skillId) {
    const [skill] = await getDb()
      .select()
      .from(personalResources)
      .where(
        and(
          owned(personalResources, scope),
          eq(personalResources.id, input.skillId),
          eq(personalResources.kind, "skill"),
          eq(personalResources.enabled, true),
        ),
      );
    if (!skill || (skill.agentId && skill.agentId !== input.agentId))
      throw personalNotFound();
    skillVersion = skill.version;
    skillSnapshot = `技能 ${skill.title} v${skill.version}\n${skill.content}`;
  }
  const nextRunAt = new Date(previewPersonalRoutine(input)[0]!);
  const data = {
    ...input,
    skillId: input.skillId ?? null,
    skillVersion,
    skillSnapshot,
    nextRunAt,
    updatedAt: new Date(),
  };
  if (existing) {
    const [row] = await getDb()
      .update(personalRoutines)
      .set({ ...data, id: existing.id, version: existing.expectedVersion + 1 })
      .where(
        and(
          owned(personalRoutines, scope),
          eq(personalRoutines.id, existing.id),
          eq(personalRoutines.version, existing.expectedVersion),
        ),
      )
      .returning();
    if (!row) throw personalConflict();
    return row;
  }
  const id = input.id ?? randomUUID();
  const [row] = await getDb()
    .insert(personalRoutines)
    .values({
      ...data,
      id,
      serverId: scope.serverId,
      ownerUserId: scope.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [previous] = await getDb()
    .select()
    .from(personalRoutines)
    .where(and(owned(personalRoutines, scope), eq(personalRoutines.id, id)));
  if (
    !previous ||
    previous.title !== data.title ||
    previous.instruction !== input.instruction ||
    previous.agentId !== input.agentId ||
    previous.channelId !== input.channelId ||
    previous.schedule !== input.schedule ||
    previous.time !== input.time ||
    previous.timezone !== input.timezone ||
    previous.weekday !== input.weekday ||
    previous.enabled !== (input.enabled ?? true) ||
    previous.skillId !== (input.skillId ?? null) ||
    previous.skillVersion !== skillVersion
  )
    throw personalConflict();
  return previous;
}
export async function togglePersonalRoutine(
  scope: PersonalScope,
  id: string,
  expectedVersion: number,
  enabled: boolean,
) {
  const [row] = await getDb()
    .select()
    .from(personalRoutines)
    .where(and(owned(personalRoutines, scope), eq(personalRoutines.id, id)));
  if (!row) throw personalNotFound();
  const nextRunAt = enabled
    ? new Date(previewPersonalRoutine(row)[0]!)
    : row.nextRunAt;
  const [updated] = await getDb()
    .update(personalRoutines)
    .set({
      enabled,
      version: expectedVersion + 1,
      nextRunAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        owned(personalRoutines, scope),
        eq(personalRoutines.id, id),
        eq(personalRoutines.version, expectedVersion),
      ),
    )
    .returning();
  if (!updated) throw personalConflict();
  return updated;
}
export async function listPersonalRoutineRuns(
  scope: PersonalScope,
  id: string,
) {
  const [row] = await getDb()
    .select()
    .from(personalRoutines)
    .where(and(owned(personalRoutines, scope), eq(personalRoutines.id, id)));
  if (!row) throw personalNotFound();
  await assertPersonalChannel(scope, row.channelId);
  return getDb()
    .select({
      id: personalRoutineRuns.id,
      routineId: personalRoutineRuns.routineId,
      scheduleVersion: personalRoutineRuns.scheduleVersion,
      scheduledFor: personalRoutineRuns.scheduledFor,
      trigger: personalRoutineRuns.trigger,
      status: personalRoutineRuns.status,
      messageId: personalRoutineRuns.messageId,
      errorCode: personalRoutineRuns.errorCode,
      createdAt: personalRoutineRuns.createdAt,
      updatedAt: personalRoutineRuns.updatedAt,
    })
    .from(personalRoutineRuns)
    .where(eq(personalRoutineRuns.routineId, id))
    .orderBy(desc(personalRoutineRuns.createdAt))
    .limit(50);
}

export async function createPersonalGroup(
  scope: PersonalScope,
  input: { id: string; title: string; agentIds: string[] },
) {
  if (
    !(await actorHasServerCapabilityInServer(
      scope.serverId,
      "user",
      scope.userId,
      "createChannels",
    ))
  )
    throw new PersonalError(
      403,
      "group_forbidden",
      "Creating conversations is not permitted",
    );
  const ids = [...new Set(input.agentIds)];
  if (ids.length < 2 || ids.length > 6)
    throw new PersonalError(
      400,
      "invalid_group_members",
      "Choose two to six assistants",
    );
  for (const id of ids) await assertPersonalAgent(scope, id);
  const [old] = await getDb()
    .select()
    .from(personalGroups)
    .where(and(owned(personalGroups, scope), eq(personalGroups.id, input.id)));
  if (old) {
    if (
      old.title !== input.title ||
      JSON.stringify(old.agentIds) !== JSON.stringify(ids)
    )
      throw personalConflict();
    return old;
  }
  return getDb().transaction(async (tx) => {
    const channel = await channelService.createChannel(
      scope.serverId,
      `group-${input.id.slice(0, 8)}`,
      input.title,
      "private",
      {
        executor: tx,
        type: "user",
        id: scope.userId,
        initialAgentIds: ids,
      },
    );
    const [row] = await tx
      .insert(personalGroups)
      .values({
        id: input.id,
        serverId: scope.serverId,
        ownerUserId: scope.userId,
        channelId: channel.id,
        title: input.title,
        agentIds: ids,
      })
      .returning();
    return row!;
  });
}
export async function savePersonalPreferences(
  scope: PersonalScope,
  value: PersonalSnapshot["preferences"],
) {
  if (value.lastAgentId) await assertPersonalAgent(scope, value.lastAgentId);
  if (value.lastChannelId)
    await assertPersonalChannel(scope, value.lastChannelId);
  const [row] = await getDb()
    .insert(personalPreferences)
    .values({ serverId: scope.serverId, userId: scope.userId, value })
    .onConflictDoUpdate({
      target: [personalPreferences.serverId, personalPreferences.userId],
      set: { value, updatedAt: new Date() },
    })
    .returning();
  return row!.value;
}

export interface DraftInput {
  id?: string;
  channelId: string;
  targetChannelId: string;
  title: string;
  content: string;
}
export async function savePersonalDraft(
  scope: PersonalScope,
  input: DraftInput,
  existing?: { id: string; expectedVersion: number },
) {
  await assertPersonalChannel(scope, input.channelId, true);
  await assertPersonalChannel(scope, input.targetChannelId, true);
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const hash = digest({
    serverId: scope.serverId,
    owner: scope.userId,
    channelId: input.channelId,
    targetChannelId: input.targetChannelId,
    content: input.content,
    title: input.title,
  });
  if (existing) {
    const [row] = await getDb()
      .update(personalDrafts)
      .set({
        ...input,
        id: existing.id,
        digest: hash,
        expiresAt,
        version: existing.expectedVersion + 1,
        state: "pending",
        updatedAt: new Date(),
      })
      .where(
        and(
          owned(personalDrafts, scope),
          eq(personalDrafts.id, existing.id),
          eq(personalDrafts.version, existing.expectedVersion),
          inArray(personalDrafts.state, ["pending", "denied", "expired"]),
        ),
      )
      .returning();
    if (!row) throw personalConflict();
    return row;
  }
  const id = input.id ?? randomUUID();
  const [row] = await getDb()
    .insert(personalDrafts)
    .values({
      ...input,
      id,
      serverId: scope.serverId,
      ownerUserId: scope.userId,
      digest: hash,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [previous] = await getDb()
    .select()
    .from(personalDrafts)
    .where(and(owned(personalDrafts, scope), eq(personalDrafts.id, id)));
  if (!previous || previous.digest !== hash) throw personalConflict();
  return previous;
}
export async function decidePersonalDraft(
  scope: PersonalScope,
  id: string,
  decision: { version: number; digest: string; approve: boolean },
  io: SocketServer,
  orchestrator: AgentOrchestrator,
) {
  const [current] = await getDb()
    .select()
    .from(personalDrafts)
    .where(and(owned(personalDrafts, scope), eq(personalDrafts.id, id)));
  if (!current) throw personalNotFound();
  await assertPersonalChannel(scope, current.channelId, true);
  await assertPersonalChannel(scope, current.targetChannelId, true);
  if (
    current.state === "executed" &&
    current.version === decision.version &&
    current.digest === decision.digest
  )
    return current;
  if (current.expiresAt.getTime() <= Date.now())
    throw new PersonalError(
      410,
      "draft_expired",
      "This action expired. Edit and confirm a new version.",
    );
  const [claimed] = await getDb()
    .update(personalDrafts)
    .set({
      state: decision.approve ? "executing" : "denied",
      updatedAt: new Date(),
    })
    .where(
      and(
        owned(personalDrafts, scope),
        eq(personalDrafts.id, id),
        eq(personalDrafts.version, decision.version),
        eq(personalDrafts.digest, decision.digest),
        eq(personalDrafts.state, "pending"),
      ),
    )
    .returning();
  if (!claimed) throw personalConflict();
  if (!decision.approve) return claimed;
  try {
    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.id, scope.userId));
    if (!user || user.retiredAt) throw personalNotFound();
    const { broadcastAndDeliver } = await import("./messageService");
    const sent = await broadcastAndDeliver(io, orchestrator, {
      channelId: claimed.targetChannelId,
      senderType: "user",
      senderId: scope.userId,
      senderName: user.displayName || user.name,
      content: claimed.content,
      randomId: `personal-draft:${id}:${claimed.version}`,
    });
    const [row] = await getDb()
      .update(personalDrafts)
      .set({
        state: "executed",
        receiptMessageId: sent.id,
        updatedAt: new Date(),
      })
      .where(eq(personalDrafts.id, id))
      .returning();
    return row!;
  } catch (error) {
    await getDb()
      .update(personalDrafts)
      .set({ state: "unknown", updatedAt: new Date() })
      .where(eq(personalDrafts.id, id));
    throw error;
  }
}
export async function reconcilePersonalDraft(scope: PersonalScope, id: string) {
  const [row] = await getDb()
    .select()
    .from(personalDrafts)
    .where(and(owned(personalDrafts, scope), eq(personalDrafts.id, id)));
  if (!row) throw personalNotFound();
  await assertPersonalChannel(scope, row.targetChannelId);
  const [message] = await getDb()
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.channelId, row.targetChannelId),
        eq(messages.senderId, scope.userId),
        eq(messages.randomId, `personal-draft:${id}:${row.version}`),
      ),
    );
  if (!message) return row;
  const [updated] = await getDb()
    .update(personalDrafts)
    .set({
      state: "executed",
      receiptMessageId: message.id,
      updatedAt: new Date(),
    })
    .where(eq(personalDrafts.id, id))
    .returning();
  return updated!;
}

/** Only the sending human's enabled platform context is injected into their own DM. */
export async function personalMessageContext(
  channelId: string,
  userId: string,
  content: string,
): Promise<string> {
  const db = getDb();
  const [channel] = await db
    .select()
    .from(channels)
    .where(
      and(
        eq(channels.id, channelId),
        eq(channels.type, "dm"),
        isNull(channels.deletedAt),
      ),
    );
  if (!channel) return "";
  const [human] = await db
    .select()
    .from(channelHumans)
    .where(
      and(
        eq(channelHumans.channelId, channelId),
        eq(channelHumans.userId, userId),
      ),
    );
  if (!human) return "";
  const peers = await db
    .select({ id: channelAgents.agentId })
    .from(channelAgents)
    .where(eq(channelAgents.channelId, channelId));
  if (peers.length !== 1) return "";
  const rows = await db
    .select()
    .from(personalResources)
    .where(
      and(
        eq(personalResources.serverId, channel.serverId),
        eq(personalResources.ownerUserId, userId),
        eq(personalResources.enabled, true),
        or(
          isNull(personalResources.agentId),
          eq(personalResources.agentId, peers[0]!.id),
        ),
      ),
    )
    .orderBy(desc(personalResources.updatedAt))
    .limit(60);
  return renderPersonalResourceContext(rows, content);
}
function renderPersonalResourceContext(
  rows: (typeof personalResources.$inferSelect)[],
  content: string,
) {
  const selected = rows.filter(
    (r) =>
      r.kind === "memory" ||
      (r.kind === "skill" && content.includes(`/${r.title}`)),
  );
  if (!selected.length) return "";
  return `[用户保存的平台上下文；当前任务的明确要求优先；停用项不在此处]\n${selected
    .map(
      (r) =>
        `${r.kind === "memory" ? "偏好" : "技能"}：${r.title} v${r.version}\n${r.content}`,
    )
    .join("\n\n")
    .slice(0, 16_000)}\n[平台上下文结束]`;
}

/** Native runtimes may read canonical history instead of draining enriched delivery payloads. */
export async function personalAgentHistoryContents(
  channelId: string,
  viewerAgentId: string,
  source: readonly { senderType: string; senderId: string; content: string }[],
): Promise<string[]> {
  const contents = source.map((message) => message.content);
  const senderIds = [
    ...new Set(
      source
        .filter((message) => message.senderType === "user")
        .map((message) => message.senderId),
    ),
  ];
  if (!senderIds.length) return contents;
  const db = getDb();
  const [channel] = await db
    .select({ serverId: channels.serverId })
    .from(channels)
    .where(
      and(
        eq(channels.id, channelId),
        eq(channels.type, "dm"),
        isNull(channels.deletedAt),
      ),
    );
  if (!channel) return contents;
  const peers = await db
    .select({ id: channelAgents.agentId })
    .from(channelAgents)
    .where(eq(channelAgents.channelId, channelId));
  if (peers.length !== 1 || peers[0]!.id !== viewerAgentId) return contents;
  const humans = await db
    .select({ id: channelHumans.userId })
    .from(channelHumans)
    .where(
      and(
        eq(channelHumans.channelId, channelId),
        inArray(channelHumans.userId, senderIds),
      ),
    );
  if (!humans.length) return contents;
  const membership = await Promise.all(
    humans.map(async (human) => ({
      id: human.id,
      role: await getActorServerRoleInServer(
        channel.serverId,
        "user",
        human.id,
      ),
    })),
  );
  const currentHumanIds = membership
    .filter((human) => human.role && human.role !== "guest")
    .map((human) => human.id);
  if (!currentHumanIds.length) return contents;
  const resources = await db
    .select()
    .from(personalResources)
    .where(
      and(
        eq(personalResources.serverId, channel.serverId),
        inArray(personalResources.ownerUserId, currentHumanIds),
        eq(personalResources.enabled, true),
        or(
          isNull(personalResources.agentId),
          eq(personalResources.agentId, viewerAgentId),
        ),
      ),
    )
    .orderBy(desc(personalResources.updatedAt))
    .limit(120);
  const latestHuman = new Map<string, number>();
  source.forEach((message, index) => {
    if (message.senderType === "user") latestHuman.set(message.senderId, index);
  });
  return source.map((message, index) => {
    if (
      message.senderType !== "user" ||
      latestHuman.get(message.senderId) !== index
    )
      return message.content;
    const context = renderPersonalResourceContext(
      resources.filter((resource) => resource.ownerUserId === message.senderId),
      message.content,
    );
    return context ? `${context}\n${message.content}` : message.content;
  });
}

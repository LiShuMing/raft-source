import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { Server as SocketServer } from "socket.io";
import { getDb } from "../db/index";
import {
  messages,
  personalRoutines,
  personalRoutineRuns,
  tasks,
  users,
} from "../db/schema";
import type { AgentOrchestrator } from "./agentOrchestrator";
import { computeNextFire } from "./recurrence";
import {
  assertPersonalAgent,
  assertPersonalChannel,
  assertPersonalMember,
  personalNotFound,
  personalRecurrence,
  type PersonalScope,
} from "./personalWorkspaceService";

const CATCHUP_MS = 2 * 60 * 60_000;
const LEASE_MS = 60_000;

/** A durable occurrence is committed before any model or delivery I/O. */
export async function collectPersonalRoutineOccurrences(now = new Date()) {
  return getDb().transaction(async (tx) => {
    const due = await tx
      .select()
      .from(personalRoutines)
      .where(
        and(
          eq(personalRoutines.enabled, true),
          lte(personalRoutines.nextRunAt, now),
        ),
      )
      .orderBy(asc(personalRoutines.nextRunAt))
      .limit(20)
      .for("update", { skipLocked: true });
    for (const routine of due) {
      const late = now.getTime() - routine.nextRunAt.getTime() > CATCHUP_MS;
      const [active] = await tx
        .select({ id: personalRoutineRuns.id })
        .from(personalRoutineRuns)
        .where(
          and(
            eq(personalRoutineRuns.routineId, routine.id),
            inArray(personalRoutineRuns.status, ["queued", "dispatched"]),
          ),
        )
        .limit(1);
      await tx
        .insert(personalRoutineRuns)
        .values({
          routineId: routine.id,
          scheduleVersion: routine.version,
          scheduledFor: routine.nextRunAt,
          instruction: [routine.instruction, routine.skillSnapshot]
            .filter(Boolean)
            .join("\n\n"),
          trigger: "scheduled",
          status: late || active ? "missed" : "queued",
          errorCode: late
            ? "catchup_window_expired"
            : active
              ? "previous_run_active"
              : null,
        })
        .onConflictDoNothing();
      // Merge backlog into one recent slot: do not enqueue every missed minute after a restart.
      const nextRunAt = computeNextFire(personalRecurrence(routine), now);
      await tx
        .update(personalRoutines)
        .set({ nextRunAt, updatedAt: now })
        .where(eq(personalRoutines.id, routine.id));
    }
    return due.length;
  });
}

export async function queuePersonalRoutineTest(
  scope: PersonalScope,
  id: string,
  requestId: string,
) {
  const [routine] = await getDb()
    .select()
    .from(personalRoutines)
    .where(
      and(
        eq(personalRoutines.id, id),
        eq(personalRoutines.serverId, scope.serverId),
        eq(personalRoutines.ownerUserId, scope.userId),
      ),
    );
  if (!routine) throw personalNotFound();
  await assertPersonalAgent(scope, routine.agentId);
  await assertPersonalChannel(scope, routine.channelId, true);
  const [row] = await getDb()
    .insert(personalRoutineRuns)
    .values({
      id: requestId,
      routineId: id,
      scheduleVersion: routine.version,
      scheduledFor: new Date(),
      trigger: "test",
      instruction: [routine.instruction, routine.skillSnapshot]
        .filter(Boolean)
        .join("\n\n"),
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [old] = await getDb()
    .select()
    .from(personalRoutineRuns)
    .where(
      and(
        eq(personalRoutineRuns.id, requestId),
        eq(personalRoutineRuns.routineId, id),
        eq(personalRoutineRuns.trigger, "test"),
      ),
    );
  if (!old) throw personalNotFound();
  return old;
}

export async function dispatchPersonalRoutineRuns(
  io: SocketServer,
  orchestrator: AgentOrchestrator,
  now = new Date(),
) {
  // Only expired leases can be reclaimed. A stable randomId makes a crash after message commit safe.
  const queued = await getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(personalRoutineRuns)
      .where(
        and(
          eq(personalRoutineRuns.status, "queued"),
          or(
            isNull(personalRoutineRuns.leaseUntil),
            lt(personalRoutineRuns.leaseUntil, now),
          ),
        ),
      )
      .orderBy(asc(personalRoutineRuns.createdAt))
      .limit(10)
      .for("update", { skipLocked: true });
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    for (const row of rows)
      await tx
        .update(personalRoutineRuns)
        .set({ leaseUntil })
        .where(eq(personalRoutineRuns.id, row.id));
    return rows.map((row) => ({ ...row, leaseUntil }));
  });
  for (const run of queued) {
    const [routine] = await getDb()
      .select()
      .from(personalRoutines)
      .where(eq(personalRoutines.id, run.routineId));
    if (!routine) continue;
    const scope = { serverId: routine.serverId, userId: routine.ownerUserId };
    try {
      await assertPersonalMember(scope);
      const agent = await assertPersonalAgent(scope, routine.agentId);
      await assertPersonalChannel(scope, routine.channelId, true);
      if (
        routine.version !== run.scheduleVersion ||
        (run.trigger === "scheduled" && !routine.enabled)
      ) {
        await finishRun(run.id, "missed", "schedule_changed");
        continue;
      }
      if (
        !agent.machineId ||
        (await orchestrator.getMachineStatus(agent.machineId)) !== "online"
      ) {
        if (now.getTime() - run.scheduledFor.getTime() > CATCHUP_MS)
          await finishRun(run.id, "missed", "computer_offline");
        else
          await getDb()
            .update(personalRoutineRuns)
            .set({
              errorCode: "waiting_for_computer",
              leaseUntil: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(personalRoutineRuns.id, run.id),
                eq(personalRoutineRuns.leaseUntil, run.leaseUntil),
              ),
            );
        continue;
      }
      const [user] = await getDb()
        .select()
        .from(users)
        .where(eq(users.id, scope.userId));
      if (!user || user.retiredAt) throw personalNotFound();
      const { broadcastAndDeliver } = await import("./messageService");
      const sent = await broadcastAndDeliver(io, orchestrator, {
        channelId: routine.channelId,
        senderType: "user",
        senderId: user.id,
        senderName: user.displayName || user.name,
        content: `定时工作：${routine.title}\n\n${run.instruction}\n\n计划时间：${run.scheduledFor.toISOString()}（${routine.timezone}）\n数据过期或不可用时明确报告；没有新结果时不要重复通知；外部写入前先准备可检查的草稿。`,
        randomId: `personal-routine:${run.id}`,
        asTask: true,
        senderTimezone: routine.timezone,
      });
      await getDb()
        .update(personalRoutineRuns)
        .set({
          status: "dispatched",
          messageId: sent.id,
          errorCode: null,
          leaseUntil: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(personalRoutineRuns.id, run.id),
            eq(personalRoutineRuns.status, "queued"),
            eq(personalRoutineRuns.leaseUntil, run.leaseUntil),
          ),
        );
    } catch {
      // No automatic second send after an ambiguous outcome: reconcile against the committed message identity.
      const [message] = await getDb()
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.senderId, scope.userId),
            eq(messages.randomId, `personal-routine:${run.id}`),
          ),
        );
      await getDb()
        .update(personalRoutineRuns)
        .set({
          status: message ? "dispatched" : "failed",
          messageId: message?.id ?? null,
          errorCode: message ? null : "dispatch_failed",
          leaseUntil: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(personalRoutineRuns.id, run.id),
            eq(personalRoutineRuns.leaseUntil, run.leaseUntil),
          ),
        );
    }
  }
  // A dispatch receipt is not completion. Only the canonical business task can supply it.
  const active = await getDb()
    .select({ runId: personalRoutineRuns.id, taskStatus: tasks.status })
    .from(personalRoutineRuns)
    .innerJoin(tasks, eq(tasks.messageId, personalRoutineRuns.messageId))
    .where(eq(personalRoutineRuns.status, "dispatched"));
  for (const item of active) {
    if (item.taskStatus === "done")
      await finishRun(item.runId, "completed", null);
    if (item.taskStatus === "closed")
      await finishRun(item.runId, "failed", "task_closed");
  }
  return queued.length;
}
async function finishRun(
  id: string,
  status: "missed" | "failed" | "completed",
  errorCode: string | null,
) {
  await getDb()
    .update(personalRoutineRuns)
    .set({ status, errorCode, leaseUntil: null, updatedAt: new Date() })
    .where(eq(personalRoutineRuns.id, id));
}
export function startPersonalRoutineWorker(
  io: SocketServer,
  orchestrator: AgentOrchestrator,
) {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await collectPersonalRoutineOccurrences();
      await dispatchPersonalRoutineRuns(io, orchestrator);
    } catch {
      console.error("[Personal routines] Scheduler pass failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, 15_000);
  timer.unref();
  void tick();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

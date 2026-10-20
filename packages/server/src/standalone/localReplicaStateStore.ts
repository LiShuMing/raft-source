import { randomUUID } from "node:crypto";
import { REPLICA_ID, fingerprintAgentRuntimeError, type MachineDuplicateHold, type MachineReplicaInstance } from "../replicaRouter";
import type { MachineConnectTraceContext } from "../tracing/migrationTraceContext";
import type { ReplicaStateStore, PersistedAgentActivity, MachineMeta, AgentRuntimeErrorMirror } from "../services/replicaStateStore";
import type { WakeCrashLoopStateRecord } from "../services/wakeCrashLoopBreaker";

/**
 * Coordination for one server process. PGlite owns durable product data; these
 * connection leases and wake locks have no remote replica and reset on exit.
 * Standard deployments continue to fail closed through the Redis adapter.
 */
export function createLocalReplicaStateStore(): ReplicaStateStore {
  const leases = new Map<string, { generation: string; updatedAtMs: number; trace?: MachineConnectTraceContext; instance?: MachineReplicaInstance }>();
  const versions = new Map<string, number>();
  const activity = new Map<string, PersistedAgentActivity>();
  const errors = new Map<string, AgentRuntimeErrorMirror>();
  const meta = new Map<string, MachineMeta>();
  const wakes = new Map<string, number>();
  const episodes = new Map<string, WakeCrashLoopStateRecord>();
  const holds = new Map<string, { value: MachineDuplicateHold; expiresAt: number }>();
  // New-process versions must exceed versions cached by an already-open browser.
  let version = Date.now() * 1000;
  const owner = (id: string) => leases.has(id) ? REPLICA_ID : null;
  const store: ReplicaStateStore = {
    isAvailable: () => true,
    async registerMachineReplica(id, trace) {
      const generation = randomUUID();
      leases.set(id, { generation, updatedAtMs: Date.now(), trace });
      return generation;
    },
    async restoreMachineReplicaGeneration(id, generation, trace) {
      if (!generation) throw new Error("Machine replica generation is required");
      leases.set(id, { generation, updatedAtMs: Date.now(), trace });
    },
    async unregisterMachineReplica(id, expected) {
      if (expected && leases.get(id)?.generation !== expected) return;
      leases.delete(id);
    },
    async refreshMachineReplica(id, trace, expected) {
      if (!expected) return "skipped_no_generation";
      const lease = leases.get(id);
      if (!lease || lease.generation !== expected) return "rejected_other_lease";
      lease.updatedAtMs = Date.now();
      lease.trace = trace;
      return "refreshed";
    },
    async hasMachineReplica(id) { return leases.has(id); },
    async getMachineReplicaOwner(id) { return owner(id); },
    async getMachineReplicaOwners(ids) { return new Map(ids.map((id) => [id, owner(id)])); },
    async getMachineReplicaTraceContext(id) { return structuredClone(leases.get(id)?.trace ?? null); },
    async getMachineReplicaLease(id) {
      const lease = leases.get(id);
      return lease ? { replicaId: REPLICA_ID, generation: lease.generation, updatedAtMs: lease.updatedAtMs, instance: structuredClone(lease.instance ?? null) } : null;
    },
    async setMachineReplicaInstance(id, instance) {
      const lease = leases.get(id);
      if (lease?.generation === instance.generation) lease.instance = structuredClone(instance);
    },
    async getMachineDuplicateHold(id) {
      const hold = holds.get(id);
      if (!hold || hold.expiresAt <= Date.now()) { holds.delete(id); return null; }
      return structuredClone(hold.value);
    },
    async setMachineDuplicateHold(id, value, ttl) { holds.set(id, { value: structuredClone(value), expiresAt: Date.now() + ttl * 1000 }); },
    async touchMachineDuplicateHold(id, ttl) {
      const hold = holds.get(id);
      if (hold && hold.expiresAt > Date.now()) hold.expiresAt = Date.now() + ttl * 1000;
    },
    async bumpMachineStatusVersion(id) { versions.set(id, ++version); return version; },
    async getMachineStatusVersion(id) { return versions.get(id) ?? 0; },
    async acquireWakeLock(id) {
      if ((wakes.get(id) ?? 0) > Date.now()) return false;
      wakes.set(id, Date.now() + 30_000);
      return true;
    },
    async releaseWakeLock(id) { wakes.delete(id); },
    async setAgentActivity(id, kind, detail, detailKind, observedAtMs, carriers) {
      activity.set(id, structuredClone({ activity: kind, detail, detailKind, observedAtMs, carriers, updatedAt: Date.now() }));
    },
    async getAgentActivity(id) { return structuredClone(activity.get(id) ?? null); },
    async setAgentRuntimeError(id, error) {
      errors.set(id, { error: structuredClone(error), fingerprint: fingerprintAgentRuntimeError(error), updatedAt: Date.now() });
    },
    async getAgentRuntimeError(id) { return structuredClone(errors.get(id) ?? null); },
    async getWakeCrashLoopState(id) { return structuredClone(episodes.get(id) ?? null); },
    async compareAndSetWakeCrashLoopState(id, expected, state) {
      if ((episodes.get(id)?.version ?? 0) !== expected) return false;
      episodes.set(id, { version: expected + 1, state: structuredClone(state) });
      return true;
    },
    async setMachineMeta(id, value) { meta.set(id, structuredClone(value)); },
    async getMachineMeta(id) { return structuredClone(meta.get(id) ?? null); },
    async clearMachineMeta(id) { meta.delete(id); },
  };
  return store;
}

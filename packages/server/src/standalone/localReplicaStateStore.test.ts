import assert from "node:assert/strict";
import { vi } from "vitest";
import { createLocalReplicaStateStore } from "./localReplicaStateStore";
import { freshWakeCrashLoopEpisode } from "../services/wakeCrashLoopBreaker";

test("a stale connection cannot release or refresh its replacement's lease", async () => {
  const store = createLocalReplicaStateStore();
  const first = await store.registerMachineReplica("host");
  const second = await store.registerMachineReplica("host");
  assert.notEqual(first, second);
  await store.unregisterMachineReplica("host", first);
  assert.equal(await store.hasMachineReplica("host"), true);
  assert.equal(await store.refreshMachineReplica("host", undefined, first), "rejected_other_lease");
  assert.equal(await store.refreshMachineReplica("host", undefined, second), "refreshed");
  assert.equal((await store.getMachineReplicaLease!("host"))?.generation, second);
  await store.unregisterMachineReplica("host", second);
  assert.equal(await store.getMachineReplicaOwner("host"), null);
});

test("local wake locks expire and new-process status versions exceed cached versions", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
    const first = createLocalReplicaStateStore();
    assert.equal(await first.acquireWakeLock("agent"), true);
    assert.equal(await first.acquireWakeLock("agent"), false);
    vi.advanceTimersByTime(30_001);
    assert.equal(await first.acquireWakeLock("agent"), true);
    const version = await first.bumpMachineStatusVersion("host");
    const second = createLocalReplicaStateStore();
    assert.ok(await second.bumpMachineStatusVersion("host") > version);
    assert.equal(await second.hasMachineReplica("host"), false);
  } finally { vi.useRealTimers(); }
});

test("wake episode updates compare versions atomically and return isolated snapshots", async () => {
  const store = createLocalReplicaStateStore();
  const episode = freshWakeCrashLoopEpisode(1);
  assert.equal(await store.compareAndSetWakeCrashLoopState("agent", 0, episode), true);
  assert.equal(await store.compareAndSetWakeCrashLoopState("agent", 0, episode), false);
  const snapshot = await store.getWakeCrashLoopState("agent");
  assert.ok(snapshot);
  snapshot.state.blocked = true;
  assert.equal((await store.getWakeCrashLoopState("agent"))?.state.blocked, false);
});

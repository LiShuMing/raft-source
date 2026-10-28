import assert from "node:assert/strict";
import { vi } from "vitest";
import type { PersonalSnapshot } from "@botiverse/raft-shared";

const mocks = vi.hoisted(() => ({
  server: { current: { id: "one" }, serverEpoch: 1 },
  user: { id: "human" },
  get: vi.fn(), post: vi.fn(), reset: (() => {}) as () => void,
}));
vi.mock("../src/api/client", () => ({ default: { get: mocks.get, post: mocks.post } }));
vi.mock("../src/store/serverStore", () => ({ useServerStore: { getState: () => mocks.server } }));
vi.mock("../src/store/authStore", () => ({ useAuthStore: { getState: () => ({ user: mocks.user }) } }));
vi.mock("../src/store/serverResetRegistry", () => ({ registerServerReset: (reset: () => void) => { mocks.reset = reset; } }));
import { personalApi, usePersonalWorkspaceStore } from "../src/store/personalWorkspaceStore";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(res => { resolve = res; }); return { promise, resolve }; }
function snapshot(name: string): PersonalSnapshot { return { resources: [], artifacts: [], tasks: [], drafts: [], routines: [], groups: [], nextTaskCursor: null, preferences: { lastAgentId: name } }; }
afterEach(() => { mocks.reset(); mocks.get.mockReset(); mocks.post.mockReset(); mocks.server.current = { id: "one" }; mocks.server.serverEpoch = 1; });

test("late workspace response cannot disclose the previous account or space after reset", async () => {
  const request = deferred<{data: PersonalSnapshot}>(); mocks.get.mockReturnValueOnce(request.promise);
  const load = usePersonalWorkspaceStore.getState().load();
  mocks.server.current = { id: "two" }; mocks.server.serverEpoch++; mocks.reset();
  request.resolve({ data: snapshot("private-old-agent") }); await load;
  assert.equal(usePersonalWorkspaceStore.getState().snapshot, null);
  mocks.get.mockResolvedValueOnce({ data: snapshot("new-agent") }); await usePersonalWorkspaceStore.getState().load();
  assert.equal(usePersonalWorkspaceStore.getState().snapshot?.preferences.lastAgentId, "new-agent");
});

test("a save refreshes after commit even if an older poll is still running", async () => {
  const old = deferred<{data: PersonalSnapshot}>(), fresh = deferred<{data: PersonalSnapshot}>();
  mocks.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const poll = usePersonalWorkspaceStore.getState().load();
  mocks.post.mockResolvedValueOnce({ data: { resource: {} } });
  const save = personalApi.saveResource({ id: "resource", agentId: null, title: "preference", content: "new content", kind: "memory", enabled: true, sourceMessageId: null });
  await vi.waitFor(() => assert.equal(mocks.get.mock.calls.length, 2));
  fresh.resolve({ data: snapshot("new") }); await save;
  old.resolve({ data: snapshot("stale") }); await poll;
  assert.equal(usePersonalWorkspaceStore.getState().snapshot?.preferences.lastAgentId, "new");
});

test("failed background refresh preserves usable data and retry clears its error", async () => {
  mocks.get.mockResolvedValueOnce({ data: snapshot("saved") }); await usePersonalWorkspaceStore.getState().load();
  mocks.get.mockRejectedValueOnce(new Error("offline")); await usePersonalWorkspaceStore.getState().load();
  assert.equal(usePersonalWorkspaceStore.getState().snapshot?.preferences.lastAgentId, "saved"); assert.equal(usePersonalWorkspaceStore.getState().error, true);
  mocks.get.mockResolvedValueOnce({ data: snapshot("recovered") }); await usePersonalWorkspaceStore.getState().load();
  assert.equal(usePersonalWorkspaceStore.getState().error, false);
});

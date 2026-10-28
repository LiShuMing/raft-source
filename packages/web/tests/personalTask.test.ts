import assert from "node:assert/strict";
import { deliverPersonalTask, personalTaskRequest } from "../src/components/personal/personalTask";

test("unknown receipts reuse the request id; changing the task or assistant creates a new id", () => {
  let serial = 0;
  const next = () => String(++serial);
  const first = personalTaskRequest(null, "agent-a", " inspect files ", next);
  assert.equal(personalTaskRequest(first, "agent-a", "inspect files", next), first);
  assert.notEqual(personalTaskRequest(first, "agent-b", "inspect files", next).randomId, first.randomId);
  assert.notEqual(personalTaskRequest(first, "agent-a", "inspect code", next).randomId, first.randomId);
  assert.throws(() => personalTaskRequest(null, "agent-a", " ", next));
});

test("switching space/account while opening a DM prevents the task send", async () => {
  const request = personalTaskRequest(null, "agent-a", "inspect files", () => "request-1");
  let current = true;
  let sends = 0;
  const channel = await deliverPersonalTask(request, {
    isCurrent: () => current,
    openDM: async () => { current = false; return { id: "dm-a" }; },
    send: async () => { sends++; },
  });
  assert.equal(channel, null);
  assert.equal(sends, 0);
});

test("a failed send is propagated and a retry delivers the same id", async () => {
  const request = personalTaskRequest(null, "agent-a", "inspect files", () => "request-1");
  const calls: unknown[] = [];
  const deps = {
    isCurrent: () => true,
    openDM: async () => ({ id: "dm-a" }),
    send: async (...args: unknown[]) => {
      calls.push(args);
      if (calls.length === 1) throw new Error("receipt lost");
    },
  };
  await assert.rejects(deliverPersonalTask(request, deps), /receipt lost/);
  assert.equal(await deliverPersonalTask(request, deps), "dm-a");
  assert.deepEqual(calls, [["dm-a", "inspect files", "request-1"], ["dm-a", "inspect files", "request-1"]]);
});

test("late receipts do not navigate a different scope, and stale work never opens a DM", async () => {
  const request = personalTaskRequest(null, "agent-a", "inspect files", () => "request-1");
  let current = true;
  let opened = 0;
  const deps = {
    isCurrent: () => current,
    openDM: async () => { opened++; return { id: "dm-a" }; },
    send: async () => { current = false; },
  };
  assert.equal(await deliverPersonalTask(request, deps), null);
  assert.equal(await deliverPersonalTask(request, deps), null);
  assert.equal(opened, 1);
});

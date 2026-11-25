import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertRemoteHost, localHostIdentity, readRemoteAttachment, remoteHome, remoteOrigin, saveRemoteAttachment, type RemoteAttachment } from "./standaloneRemoteState";

test("remote origins reject credentials, redirects to paths and unencrypted non-loopback endpoints", () => {
  assert.equal(remoteOrigin("https://center.example.test/"), "https://center.example.test");
  assert.equal(remoteOrigin("http://127.0.0.1:15280"), "http://127.0.0.1:15280");
  for (const origin of ["http://192.0.2.1:5280", "https://user:pass@center.test", "https://center.test/api", "https://center.test/?token=secret", "file:///tmp"]) {
    assert.throws(() => remoteOrigin(origin));
  }
  assert.notEqual(remoteHome("https://a.test", "work", {}), remoteHome("https://b.test", "work", {}));
  assert.notEqual(remoteHome("https://a.test", "work", {}), remoteHome("https://a.test", "other", {}));
});

test("attachments preserve independent machine identities, private credentials and refuse another host or user", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "raft-remote-state-"));
  const host = await localHostIdentity();
  const first: RemoteAttachment = { version: 1, origin: "https://center.test", serverSlug: "work", serverId: randomUUID(),
    machineId: randomUUID(), computerId: randomUUID(), name: "machine-a", host };
  const second: RemoteAttachment = { ...first, name: "machine-b", machineId: randomUUID(), computerId: randomUUID() };
  try {
    await saveRemoteAttachment(path.join(parent, "a"), first, "sk_computer_independent_a");
    await saveRemoteAttachment(path.join(parent, "b"), second, "sk_computer_independent_b");
    assert.deepEqual(await readRemoteAttachment(path.join(parent, "a")), first);
    assert.deepEqual(await readRemoteAttachment(path.join(parent, "b")), second);
    assert.equal((await stat(path.join(parent, "a/computer.key"))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(parent, "a"))).mode & 0o777, 0o700);
    assert.equal((await readFile(path.join(parent, "a/attachment.json"), "utf8")).includes("sk_computer_"), false);
    assert.throws(() => assertRemoteHost(first, { ...host, hostname: "other-host" }), /another host/);
    assert.throws(() => assertRemoteHost(first, { ...host, username: "other-user" }), /another host/);
    await assert.rejects(saveRemoteAttachment(path.join(parent, "a"), second, "sk_computer_replacement"), /EEXIST/);
    assert.equal(await readFile(path.join(parent, "a/computer.key"), "utf8"), "sk_computer_independent_a");
  } finally { await rm(parent, { recursive: true, force: true }); }
});

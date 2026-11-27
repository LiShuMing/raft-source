import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  removeStandaloneServiceStateIfOwned,
  resolveStandaloneCheckpointIntervalMs,
  rotateLogFileIfNeeded,
  standaloneServiceStatePath,
  startStandalonePgliteMaintenance,
  writeStandaloneServiceState,
} from "./maintenance";

test("rotateLogFileIfNeeded rotates oversized logs up to maxFiles and leaves small logs untouched", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "raft-log-rotate-"));
  try {
    const logPath = path.join(dir, "runner.log");
    await writeFile(logPath, "small");
    assert.equal(rotateLogFileIfNeeded(logPath, { maxBytes: 100, maxFiles: 2 }), false);
    assert.equal(await readFile(logPath, "utf8"), "small");

    await writeFile(logPath, "A".repeat(120));
    assert.equal(rotateLogFileIfNeeded(logPath, { maxBytes: 100, maxFiles: 2 }), true);
    assert.equal(await readFile(`${logPath}.1`, "utf8"), "A".repeat(120));

    await writeFile(logPath, "B".repeat(120));
    assert.equal(rotateLogFileIfNeeded(logPath, { maxBytes: 100, maxFiles: 2 }), true);
    assert.equal(await readFile(`${logPath}.1`, "utf8"), "B".repeat(120));
    assert.equal(await readFile(`${logPath}.2`, "utf8"), "A".repeat(120));

    await writeFile(logPath, "C".repeat(120));
    assert.equal(rotateLogFileIfNeeded(logPath, { maxBytes: 100, maxFiles: 2 }), true);
    assert.equal(await readFile(`${logPath}.1`, "utf8"), "C".repeat(120));
    assert.equal(await readFile(`${logPath}.2`, "utf8"), "B".repeat(120));
    await assert.rejects(stat(`${logPath}.3`), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("service.json writes atomically with mode 0600 and removes only when owned by pid", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "raft-service-state-"));
  try {
    const statePath = await writeStandaloneServiceState(dir, {
      pid: 12345,
      cwd: "/app/packages/server",
      host: "127.0.0.1",
      port: 5280,
      entrypoint: "src/standalone.ts",
      htmlPreview: "offline-static",
      startedAt: "2026-11-27T00:00:00.000Z",
    });
    assert.equal(statePath, standaloneServiceStatePath(dir));
    assert.equal((await stat(statePath)).mode & 0o777, 0o600);
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as { pid: number; port: number };
    assert.equal(parsed.pid, 12345);
    assert.equal(parsed.port, 5280);

    assert.equal(await removeStandaloneServiceStateIfOwned(dir, 99999), false);
    assert.equal(await removeStandaloneServiceStateIfOwned(dir, 12345), true);
    await assert.rejects(stat(statePath), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("startStandalonePgliteMaintenance prevents overlapping checkpoints, handles errors, and honors interval=0", async () => {
  assert.equal(resolveStandaloneCheckpointIntervalMs({ RAFT_STANDALONE_CHECKPOINT_INTERVAL_MS: "0" }), 0);
  assert.equal(resolveStandaloneCheckpointIntervalMs({ RAFT_STANDALONE_CHECKPOINT_INTERVAL_MS: "60000" }), 60_000);
  assert.ok(resolveStandaloneCheckpointIntervalMs({ RAFT_STANDALONE_CHECKPOINT_INTERVAL_MS: "bad" }) > 0);

  let release!: () => void;
  let calls = 0;
  const handle = startStandalonePgliteMaintenance({
    intervalMs: 0,
    checkpoint: () => new Promise<boolean>((resolve) => {
      calls += 1;
      release = () => resolve(true);
    }),
  });
  const first = handle.runNow();
  const second = handle.runNow();
  assert.equal(await second, false);
  release();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  handle.stop();
  assert.equal(await handle.runNow(), false);

  const logs: string[] = [];
  const failing = startStandalonePgliteMaintenance({
    intervalMs: 0,
    checkpoint: async () => { throw new Error("boom"); },
    log: (msg) => logs.push(msg),
  });
  assert.equal(await failing.runNow(), false);
  assert.match(logs[0] ?? "", /checkpoint failed: boom/);
  failing.stop();
});

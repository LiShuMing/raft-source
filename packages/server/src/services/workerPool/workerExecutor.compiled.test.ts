import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createWorkerThreadExecutor } from "./workerExecutor";

test("native JS worker runs without an injected source loader", { timeout: 10000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "raft-js-worker-"));
  const entry = path.join(directory, "worker.mjs");
  await writeFile(entry, `import { parentPort } from "node:worker_threads";
    parentPort.on("message", ({taskId, payload}) => {
      parentPort.postMessage({taskId, ok:true, result:{payload, argv:process.execArgv}, runMs:0});
    });`);
  const executor = createWorkerThreadExecutor({ poolSize: 1, workerEntryUrl: pathToFileURL(entry) });
  try {
    const response = await executor.execute({
      taskId: "native-js", kind: "echo", payload: "hello", traceContext: null,
      prepared: { payload: "hello", payloadKind: "value", transferList: [] },
    });
    const result = response.result as { payload: string; argv: string[] };
    assert.equal(result.payload, "hello");
    assert.deepEqual(result.argv, process.execArgv);
    assert.ok(!result.argv.some((arg) => arg.includes("@oxc-node/core")));
  } finally {
    await executor.close();
    await rm(directory, { recursive: true, force: true });
  }
});

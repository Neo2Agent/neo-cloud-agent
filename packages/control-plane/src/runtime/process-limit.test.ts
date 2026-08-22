import assert from "node:assert/strict";
import test from "node:test";
import { localWorkerNodeArgs } from "./local.js";
import { heapMiBForWorker, nodeHeapArgs } from "./process-limit.js";

test("worker heap is 80% of the RSS cap with a 96MiB floor", () => {
  assert.equal(heapMiBForWorker(0), 0);
  assert.equal(heapMiBForWorker(-1), 0);
  assert.equal(heapMiBForWorker(512), 409);
  assert.equal(heapMiBForWorker(100), 96);
  assert.deepEqual(nodeHeapArgs(512), ["--max-old-space-size=409"]);
  assert.deepEqual(nodeHeapArgs(0), []);
  assert.deepEqual(localWorkerNodeArgs(512, "tsx.mjs", "worker.ts"), [
    "--max-old-space-size=409",
    "tsx.mjs",
    "worker.ts",
  ]);
});

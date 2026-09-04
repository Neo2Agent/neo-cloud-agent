import assert from "node:assert/strict";
import test from "node:test";
import { createTermWriteQueue } from "./term-write.js";

test("batches keystrokes until flush", async () => {
  const sent: string[] = [];
  const queue = createTermWriteQueue((data) => sent.push(data), 15);
  queue.push("l");
  queue.push("s");
  assert.deepEqual(sent, []);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(sent, ["ls"]);
});

test("immediate flush sends Enter without waiting", () => {
  const sent: string[] = [];
  const queue = createTermWriteQueue((data) => sent.push(data), 50);
  queue.push("ls");
  queue.push("\r", true);
  assert.deepEqual(sent, ["ls\r"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { toRunEvents } from "./events.js";

test("maps pi session events to RunEvents", () => {
  const start = toRunEvents("run1", { type: "agent_start" });
  assert.equal(start[0]?.kind, "agent.start");

  const delta = toRunEvents("run1", {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "Hello" },
  });
  assert.equal(delta[0]?.kind, "message.delta");
  assert.equal(delta[0]?.data?.delta, "Hello");

  const tool = toRunEvents("run1", { type: "tool_execution_start", toolName: "bash", args: { command: "ls" } });
  assert.equal(tool[0]?.kind, "tool.start");
  assert.equal(tool[0]?.data?.toolName, "bash");

  const done = toRunEvents("run1", {
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "ls" },
    isError: false,
    result: { content: [{ type: "text", text: "README.md\n" }] },
  });
  assert.equal(done[0]?.kind, "tool.end");
  assert.equal(done[0]?.data?.toolCallId, "call-1");
  assert.equal(done[0]?.data?.output, "README.md\n");
  assert.deepEqual(done[0]?.data?.args, { command: "ls" });

  const update = toRunEvents("run1", {
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "ls" },
    partialResult: { content: [{ type: "text", text: "README" }] },
  });
  assert.equal(update[0]?.kind, "tool.update");
  assert.equal(update[0]?.data?.output, "README");
});

test("ignores unknown or empty deltas", () => {
  assert.deepEqual(toRunEvents("run1", { type: "queue_update" }), []);
  assert.deepEqual(
    toRunEvents("run1", { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "..." } }),
    [],
  );
});

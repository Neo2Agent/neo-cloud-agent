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
});

test("ignores unknown or empty deltas", () => {
  assert.deepEqual(toRunEvents("run1", { type: "queue_update" }), []);
  assert.deepEqual(
    toRunEvents("run1", { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "..." } }),
    [],
  );
});

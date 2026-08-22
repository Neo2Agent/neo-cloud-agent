import assert from "node:assert/strict";
import test from "node:test";
import { assembleContextUsage } from "@neo-cloud-agent/contracts";
import { contextUsageEvent, stampWorkerSeq, toRunEvents } from "./events.js";

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
  const edited = toRunEvents("run1", {
    type: "tool_execution_end",
    toolCallId: "edit-1",
    toolName: "edit",
    args: { path: "README.md", edits: [{ oldText: "a", newText: "b" }] },
    result: { content: [{ type: "text", text: "ok" }], details: { diff: "-a\n+b\n" } },
  });
  assert.deepEqual(edited[0]?.data?.details, { diff: "-a\n+b\n" });

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

test("maps token usage on agent_end", () => {
  const events = toRunEvents("run1", {
    type: "agent_end",
    usage: { input: 12, output: 4 },
  });
  assert.equal(events[0]?.kind, "agent.end");
  assert.equal(events[1]?.kind, "llm.usage");
  assert.deepEqual(events[1]?.data, { promptTokens: 12, completionTokens: 4, totalTokens: 16 });
});

test("stamps a monotonic workerSeq onto each event", () => {
  const next = { value: 0 };
  const first = stampWorkerSeq(toRunEvents("run1", { type: "agent_start" }), next);
  const second = stampWorkerSeq(
    toRunEvents("run1", {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hi" },
    }),
    next,
  );
  assert.equal(first[0]?.data?.workerSeq, 1);
  assert.equal(second[0]?.data?.workerSeq, 2);
});

test("context usage event keeps a null window for unknown models", () => {
  const event = contextUsageEvent("run1", assembleContextUsage({ conversationText: "hi" }));
  assert.equal(event.kind, "context.usage");
  assert.equal(event.data?.contextWindow, null);
});

test("ignores unknown or empty deltas", () => {
  assert.deepEqual(toRunEvents("run1", { type: "queue_update" }), []);
  assert.deepEqual(
    toRunEvents("run1", { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "..." } }),
    [],
  );
});

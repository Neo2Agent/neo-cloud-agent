import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { StartTurnRequest, ToolsChannelFrame } from "@neo-cloud-agent/contracts";
import type { LoopEvent } from "./cloud.js";
import type { ToolsHub, ToolCallResult } from "./hub.js";
import { classifyRepeat, isSleepPoll, needsWrap, toolSignature, WRAP_STEER, WRAP_TOOL_ROUNDS, SLEEP_POLL_NOTE, DUPLICATE_STOP, RUNAWAY_STOP } from "./repeat.js";
import { runTurn, type Infer, type TurnControl } from "./turn.js";

test("the same command runs once, replays the second time, and stops on the third", () => {
  const signature = toolSignature("bash", { command: "ls" });
  const first = classifyRepeat({ last: "", streak: 0 }, signature);
  assert.equal(first.action, "run");
  const second = classifyRepeat(first.state, signature);
  assert.equal(second.action, "replay");
  const third = classifyRepeat(second.state, toolSignature("bash", { command: "ls" }));
  assert.equal(third.action, "stop");
});

test("a different command resets the repeat streak", () => {
  const first = classifyRepeat({ last: "", streak: 0 }, toolSignature("bash", { command: "ls" }));
  const again = classifyRepeat(first.state, toolSignature("bash", { command: "ls" }));
  const other = classifyRepeat(again.state, toolSignature("read", { path: "a.md" }));
  assert.equal(other.action, "run");
  assert.equal(other.state.streak, 1);
});

test("argument key order does not make the same command look new", () => {
  assert.equal(toolSignature("bash", { command: "ls", cwd: "." }), toolSignature("bash", { cwd: ".", command: "ls" }));
});

test("a written close is requested at 40 tool rounds, not at 200", () => {
  assert.equal(WRAP_TOOL_ROUNDS, 40);
  assert.equal(needsWrap(WRAP_TOOL_ROUNDS - 1), false);
  assert.equal(needsWrap(WRAP_TOOL_ROUNDS), true);
});

test("long sleeps share one signature and short sleeps do not", () => {
  assert.equal(isSleepPoll("sleep 8"), false);
  assert.equal(isSleepPoll("sleep 15"), true);
  assert.equal(isSleepPoll("echo hi; sleep 50; tail log"), true);
  assert.equal(isSleepPoll("sleeper 50"), false);
  assert.equal(
    toolSignature("bash", { command: "sleep 50" }),
    toolSignature("bash", { command: "nohup ./gradlew test & sleep 55; tail log" }),
  );
  assert.notEqual(toolSignature("bash", { command: "sleep 8" }), toolSignature("bash", { command: "sleep 50" }));
});

test("the remote loop asks for a close instead of failing a normal explore early", () => {
  const turn = readFileSync(new URL("./turn.ts", import.meta.url), "utf8");
  const repeat = readFileSync(new URL("./repeat.ts", import.meta.url), "utf8");
  assert.doesNotMatch(turn, /工具回合过多/);
  assert.doesNotMatch(turn, /MAX_ROUNDS/);
  assert.doesNotMatch(repeat, /SAFETY_TOOL_ROUNDS/);
  assert.match(turn, /DUPLICATE_STOP/);
  assert.match(turn, /RUNAWAY_STOP/);
  assert.match(turn, /WRAP_STEER/);
  assert.match(repeat, /WRAP_TOOL_ROUNDS = 40/);
});

test("a long sleep is not executed, and the third one stops the turn", async () => {
  const commands = ["sleep 50", "sleep 55", "sleep 40"];
  let step = 0;
  const execs: string[] = [];
  const { events, completed } = await scriptTurn({
    infer: async () => {
      step += 1;
      const command = commands[step - 1];
      if (!command) {
        return textReply("should not run");
      }
      return toolReply("bash", { command });
    },
    onExec: (command) => {
      execs.push(command);
      return "ran";
    },
  });
  assert.deepEqual(execs, []);
  assert.equal(events.filter((event) => event.kind === "tool.start").length, 1);
  assert.equal(events.some((event) => event.kind === "tool.end" && event.data.output === SLEEP_POLL_NOTE), true);
  assert.equal(events.some((event) => event.kind === "llm.error" && event.data.error === DUPLICATE_STOP), true);
  assert.equal(completed?.status, "error");
  assert.equal(completed?.errorMessage, DUPLICATE_STOP);
});

test("a short sleep still runs", async () => {
  const execs: string[] = [];
  const { completed } = await scriptTurn({
    infer: async ({ messages }) => {
      assert.match(String(messages[0]?.content), /Do not use sleep to poll/);
      assert.match(String(messages[0]?.content), /read, grep, find, ls/);
      if (execs.length === 0) {
        return toolReply("bash", { command: "sleep 8; echo done" });
      }
      return textReply("done");
    },
    onExec: (command) => {
      execs.push(command);
      return "done";
    },
  });
  assert.deepEqual(execs, ["sleep 8; echo done"]);
  assert.equal(completed?.status, "idle");
});

test("bash output is published before the command finishes", async () => {
  let sent = false;
  const { events } = await scriptTurn({
    infer: async () => {
      if (sent) {
        return textReply("done");
      }
      sent = true;
      return toolReply("bash", { command: "echo hi" });
    },
    onExec: () => "partial\nfinal",
    onChunk: (push) => {
      push("partial");
    },
  });
  const updates = events.filter((event) => event.kind === "tool.update").map((event) => event.data.output);
  assert.equal(updates.includes("partial"), true);
  assert.equal(updates.includes("partial\nfinal"), true);
});

test("read-only tools in one reply overlap, and bash waits for them", async () => {
  const order: string[] = [];
  let active = 0;
  let maxActive = 0;
  let replied = false;
  const { completed } = await scriptTurn({
    infer: async () => {
      if (replied) {
        return textReply("done");
      }
      replied = true;
      return {
        content: "",
        promptTokens: 1,
        completionTokens: 1,
        toolCalls: [
          call("read", { path: "a" }, "read-a"),
          call("read", { path: "b" }, "read-b"),
          call("bash", { command: "echo hi" }, "bash-1"),
        ],
      };
    },
    track(label: string) {
      order.push(`start ${label}`);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) => {
        setTimeout(() => {
          active -= 1;
          order.push(`end ${label}`);
          resolve("ok");
        }, 20);
      });
    },
  });
  assert.equal(maxActive >= 2, true);
  const bashStart = order.indexOf("start exec:echo hi");
  assert.ok(order.indexOf("end read:a") < bashStart);
  assert.ok(order.indexOf("end read:b") < bashStart);
  assert.equal(completed?.status, "idle");
});

test("two bash commands in one reply stay in order", async () => {
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  let replied = false;
  await scriptTurn({
    infer: async () => {
      if (replied) {
        return textReply("done");
      }
      replied = true;
      return {
        content: "",
        promptTokens: 1,
        completionTokens: 1,
        toolCalls: [call("bash", { command: "echo 1" }, "b1"), call("bash", { command: "echo 2" }, "b2")],
      };
    },
    track(label: string) {
      order.push(label);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) => {
        setTimeout(() => {
          active -= 1;
          resolve("ok");
        }, 15);
      });
    },
  });
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ["exec:echo 1", "exec:echo 2"]);
});

test("after 40 tool rounds the next text reply finishes, and another tool call stops", async () => {
  const closed = await scriptTurn({
    infer: async ({ messages }) => {
      const rounds = messages.filter((message) => message.role === "assistant" && message.tool_calls?.length).length;
      if (messages.some((message) => message.content === WRAP_STEER)) {
        return textReply("summary");
      }
      return toolReply("bash", { command: `echo ${rounds}` });
    },
    onExec: () => "ok",
  });
  assert.equal(closed.completed?.status, "idle");
  assert.equal(closed.execs.length, WRAP_TOOL_ROUNDS);
  assert.equal(closed.events.some((event) => event.kind === "message.delta" && event.data.delta === "summary"), true);

  const overrun = await scriptTurn({
    infer: async ({ messages }) => {
      const rounds = messages.filter((message) => message.role === "assistant" && message.tool_calls?.length).length;
      return toolReply("bash", { command: `echo ${rounds}` });
    },
    onExec: () => "ok",
  });
  assert.equal(overrun.completed?.status, "error");
  assert.equal(overrun.completed?.errorMessage, RUNAWAY_STOP);
  assert.equal(overrun.execs.length, WRAP_TOOL_ROUNDS);
  assert.equal(overrun.events.some((event) => event.kind === "llm.error" && event.data.error === RUNAWAY_STOP), true);
});

function call(name: string, args: Record<string, unknown>, id: string) {
  return { id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } };
}

function toolReply(name: string, args: Record<string, unknown>) {
  return { content: "", promptTokens: 1, completionTokens: 1, toolCalls: [call(name, args, `${name}-${args.command ?? args.path ?? "x"}`)] };
}

function textReply(content: string) {
  return { content, promptTokens: 1, completionTokens: 1, toolCalls: [] };
}

async function scriptTurn(input: {
  infer: Infer;
  onExec?: (command: string) => string;
  onChunk?: (push: (text: string) => void) => void;
  track?: (label: string) => Promise<string>;
}): Promise<{ events: LoopEvent[]; execs: string[]; completed?: { status: string; errorMessage: string } }> {
  const events: LoopEvent[] = [];
  const execs: string[] = [];
  let completed: { status: string; errorMessage: string } | undefined;
  const cloud = {
    async emit(_runId: string, batch: LoopEvent[]) {
      events.push(...batch);
    },
    async heartbeat() {},
    async complete(_runId: string, _turnId: string, status: string, errorMessage: string) {
      completed = { status, errorMessage };
    },
    async loadSession() {
      return {};
    },
    async saveSession() {},
  };
  const hub = {
    async waitReady() {
      return "/tmp/desk";
    },
    abortAll() {},
    async call(_runId: string, frame: ToolsChannelFrame, _timeout?: number, onChunk?: (text: string) => void): Promise<ToolCallResult> {
      if (frame.type === "exec") {
        execs.push(frame.command);
        input.onChunk?.(onChunk ?? (() => {}));
        const text = input.track ? await input.track(`exec:${frame.command}`) : (input.onExec?.(frame.command) ?? "ok");
        return { ok: true, text, stdout: text };
      }
      if (frame.type === "fs.download") {
        const text = input.track ? await input.track(`read:${frame.path}`) : "file";
        return { ok: true, text, stdout: "" };
      }
      if (frame.type === "fs.list") {
        const text = input.track ? await input.track(`ls:${frame.path}`) : "names";
        return { ok: true, text, stdout: "" };
      }
      return { ok: true, text: "ok", stdout: "" };
    },
  };
  const controller = new AbortController();
  const control: TurnControl = {
    signal: controller.signal,
    aborted: () => controller.signal.aborted,
    takeSteer: () => undefined,
  };
  const request: StartTurnRequest = {
    runId: "run",
    turnId: "turn",
    orgId: "org",
    userId: "user",
    delivery: "prompt",
    text: "look",
    model: "neo/mock",
    jwt: "jwt",
    llmGatewayUrl: "http://127.0.0.1:9",
    controlPlaneUrl: "http://127.0.0.1:9",
    tools: { mode: "worker_ws", url: "inbound", sandboxRoot: "." },
  };
  await runTurn({
    request,
    cloud,
    hub: hub as unknown as ToolsHub,
    infer: input.infer,
    control,
  });
  return { events, execs, completed };
}

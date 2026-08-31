import assert from "node:assert/strict";
import test from "node:test";
import type { WorkerInbound } from "@neo-cloud-agent/contracts";
import { isInterrupt, isUserTurn, runInboxLoop } from "./inbox-loop.js";

function prompt(text: string): WorkerInbound {
  return { type: "prompt", text };
}

test("isUserTurn and isInterrupt classify inbox messages", () => {
  assert.equal(isUserTurn(prompt("hi")), true);
  assert.equal(isUserTurn({ type: "steer", text: "nudge" }), true);
  assert.equal(isUserTurn({ type: "follow_up", text: "later" }), true);
  assert.equal(isUserTurn({ type: "abort" }), false);
  assert.equal(isInterrupt({ type: "abort" }), true);
  assert.equal(isInterrupt({ type: "shutdown", reason: "idle" }), true);
  assert.equal(isInterrupt(prompt("hi")), false);
});

test("abort is dispatched while the current prompt is still running", async () => {
  const order: string[] = [];
  let releasePrompt!: () => void;
  const promptGate = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  let streaming = false;
  const inbox: WorkerInbound[][] = [[prompt("long turn")], [{ type: "abort" }], []];
  let pulls = 0;

  const done = runInboxLoop({
    pull: async () => inbox[Math.min(pulls++, inbox.length - 1)] ?? [],
    dispatch: async (message) => {
      order.push(`start:${message.type}`);
      if (message.type === "prompt") {
        streaming = true;
        await promptGate;
        streaming = false;
      }
      order.push(`end:${message.type}`);
      return "continue";
    },
    isStreaming: () => streaming,
    pollMs: 5,
    exitAfterTurn: true,
  });

  const started = Date.now();
  while (!order.includes("start:abort") && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(order.includes("start:prompt"));
  assert.ok(order.includes("start:abort"), `abort should run during the prompt, got ${order.join(",")}`);
  assert.equal(order.includes("end:prompt"), false);
  releasePrompt();
  await done;
  assert.ok(order.includes("end:prompt"));
  assert.ok(order.includes("end:abort"));
});

test("same-batch prompt then abort interrupts the turn that just started", async () => {
  const order: string[] = [];
  let streaming = false;
  let pulls = 0;
  const inbox: WorkerInbound[][] = [[prompt("first"), { type: "abort" }], []];

  await runInboxLoop({
    pull: async () => inbox[Math.min(pulls++, inbox.length - 1)] ?? [],
    dispatch: async (message) => {
      order.push(message.type);
      if (message.type === "prompt") {
        streaming = true;
        await new Promise((resolve) => setTimeout(resolve, 20));
        streaming = false;
      }
      return "continue";
    },
    isStreaming: () => streaming,
    pollMs: 5,
    exitAfterTurn: true,
  });

  assert.deepEqual(order, ["prompt", "abort"]);
});

test("abort before a turn starts skips the queued prompt and still finishes the turn", async () => {
  const dispatched: string[] = [];
  const finished: string[] = [];
  let pulls = 0;
  const inbox: WorkerInbound[][] = [[{ type: "abort" }, prompt("should not run")], []];

  await runInboxLoop({
    pull: async () => inbox[Math.min(pulls++, inbox.length - 1)] ?? [],
    dispatch: async (message) => {
      dispatched.push(message.type);
      return message.type === "shutdown" ? "stop" : "continue";
    },
    afterUserTurn: async (message) => {
      finished.push(message.type);
    },
    isStreaming: () => false,
    pollMs: 5,
    exitAfterTurn: true,
  });

  assert.deepEqual(dispatched, ["abort"]);
  assert.deepEqual(finished, ["abort"]);
});

test("steer during a live turn is delivered before the prompt returns", async () => {
  const order: string[] = [];
  let releasePrompt!: () => void;
  const promptGate = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  let streaming = false;
  const inbox: WorkerInbound[][] = [[prompt("live")], [{ type: "steer", text: "go left" }], []];
  let pulls = 0;

  const done = runInboxLoop({
    pull: async () => inbox[Math.min(pulls++, inbox.length - 1)] ?? [],
    dispatch: async (message) => {
      order.push(`start:${message.type}`);
      if (message.type === "prompt") {
        streaming = true;
        await promptGate;
        streaming = false;
      }
      order.push(`end:${message.type}`);
      return "continue";
    },
    afterUserTurn: async (message) => {
      order.push(`finish:${message.type}`);
    },
    isStreaming: () => streaming,
    pollMs: 5,
    exitAfterTurn: true,
  });

  const started = Date.now();
  while (!order.includes("end:steer") && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(order.includes("end:steer"));
  assert.equal(order.includes("finish:steer"), false);
  assert.equal(order.includes("end:prompt"), false);
  releasePrompt();
  await done;
  assert.ok(order.includes("finish:prompt"));
});

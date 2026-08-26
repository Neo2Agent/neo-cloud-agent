import assert from "node:assert/strict";
import test from "node:test";
import type { DeskInboxEvent } from "@neo-cloud-agent/contracts";
import { openDeskInboxStream } from "./inbox.js";

function streamOf(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

test("the desk reads assignments off its own outbound stream", async () => {
  const seen: DeskInboxEvent[] = [];
  const states: boolean[] = [];
  const handle = openDeskInboxStream({
    baseUrl: "http://cp.test/",
    deskId: "desk_1",
    deskToken: "desk_tok",
    retryMs: 50_000,
    onEvent: (event) => seen.push(event),
    onStateChange: (connected) => states.push(connected),
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "http://cp.test/v1/desks/desk_1/inbox");
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer desk_tok");
      return streamOf([
        'data: {"kind":"ping"}\n\n',
        'data: {"kind":"assignment","assignment":{"runId":"run_1"}}\n\n',
        // A frame that arrives split across chunks must still be parsed once.
        'data: {"kind":"cancel","runId":',
        '"run_1"}\n\n',
      ]);
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  handle.close();
  assert.deepEqual(
    seen.map((item) => item.kind),
    ["ping", "assignment", "cancel"],
  );
  assert.equal(states[0], true);
});

test("a malformed frame is dropped without killing the stream", async () => {
  const seen: DeskInboxEvent[] = [];
  const handle = openDeskInboxStream({
    baseUrl: "http://cp.test",
    deskId: "desk_1",
    deskToken: "desk_tok",
    retryMs: 50_000,
    onEvent: (event) => seen.push(event),
    fetchImpl: async () => streamOf(["data: {oops\n\n", 'data: {"kind":"ping"}\n\n']),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  handle.close();
  assert.deepEqual(seen.map((item) => item.kind), ["ping"]);
});

test("a 401 asks the host to re-register instead of retrying the dead token", async () => {
  let calls = 0;
  let unauthorized = 0;
  const handle = openDeskInboxStream({
    baseUrl: "http://cp.test",
    deskId: "desk_1",
    deskToken: "stale",
    retryMs: 5,
    onEvent: () => undefined,
    onUnauthorized: () => {
      unauthorized += 1;
    },
    fetchImpl: async () => {
      calls += 1;
      return new Response("gone", { status: 401 });
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  handle.close();
  assert.equal(calls, 1);
  assert.equal(unauthorized, 1);
});

test("closing stops the reconnect loop", async () => {
  let calls = 0;
  const handle = openDeskInboxStream({
    baseUrl: "http://cp.test",
    deskId: "desk_1",
    deskToken: "desk_tok",
    retryMs: 5,
    onEvent: () => undefined,
    fetchImpl: async () => {
      calls += 1;
      return new Response("nope", { status: 500 });
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  handle.close();
  const seenSoFar = calls;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, seenSoFar);
  assert.ok(seenSoFar >= 1);
});

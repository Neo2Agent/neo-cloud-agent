import assert from "node:assert/strict";
import test from "node:test";
import { BAD_RECORDING_HINT, EMPTY_RECORDING_HINT } from "./cloud.js";
import { startPageVoice } from "./page.js";

test("startPageVoice uses live capture when the mic exists", async () => {
  const calls: number[] = [];
  const started = await startPageVoice(
    async (body) => {
      calls.push(body.status);
      return { sessionId: "s1", text: "你好" };
    },
    () => undefined,
    undefined,
    undefined,
    {
      allowLiveMic: true,
      liveCapture: {
        start: async (onFrame) => {
          onFrame(Uint8Array.from([1, 0]));
        },
        stop: async () => undefined,
      },
    },
  );
  assert.equal(started.kind, "session");
  if (started.kind !== "session") throw new Error("expected session");
  const spoken = await started.session.stop();
  assert.equal(spoken, "你好");
  assert.ok(calls.includes(2));
});

test("startPageVoice transcribes a picked file on HTTP pages", async () => {
  const file = new File([Uint8Array.from([1])], "a.wav", { type: "audio/wav" });
  const pcm = Uint8Array.from([1, 0, 2, 0, 3, 0]);
  const started = await startPageVoice(
    async (body) => ({ sessionId: "s1", text: body.status === 2 ? "打开仓库" : "打开" }),
    () => undefined,
    undefined,
    undefined,
    {
      allowLiveMic: false,
      pickFile: async () => file,
      decodeFile: async () => pcm,
    },
  );
  assert.equal(started.kind, "transcript");
  if (started.kind !== "transcript") throw new Error("expected transcript");
  assert.equal(started.text, "打开仓库");
});

test("startPageVoice treats a dismissed picker as cancelled", async () => {
  const started = await startPageVoice(
    async () => ({ sessionId: "s1", text: "" }),
    () => undefined,
    undefined,
    undefined,
    {
      allowLiveMic: false,
      pickFile: async () => null,
    },
  );
  assert.equal(started.kind, "cancelled");
});

test("startPageVoice maps an empty recording", async () => {
  const started = await startPageVoice(
    async () => ({ sessionId: "s1", text: "" }),
    () => undefined,
    undefined,
    undefined,
    {
      allowLiveMic: false,
      pickFile: async () => new File([Uint8Array.from([1])], "a.wav"),
      decodeFile: async () => new Uint8Array(),
    },
  );
  assert.deepEqual(started, { kind: "error", message: EMPTY_RECORDING_HINT });
});

test("startPageVoice maps a broken file to a recording hint", async () => {
  const started = await startPageVoice(
    async () => ({ sessionId: "s1", text: "" }),
    () => undefined,
    undefined,
    undefined,
    {
      allowLiveMic: false,
      pickFile: async () => new File([Uint8Array.from([1])], "a.amr"),
      decodeFile: async () => {
        throw new Error("Unable to decode");
      },
    },
  );
  assert.deepEqual(started, { kind: "error", message: BAD_RECORDING_HINT });
});

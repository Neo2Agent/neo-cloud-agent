import assert from "node:assert/strict";
import test from "node:test";
import { BAD_RECORDING_HINT, EMPTY_RECORDING_HINT } from "./cloud.js";
import { NOT_AUDIO_FILE_HINT } from "./file.js";
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
  const calls: Array<{ status: number; hasAudio: boolean }> = [];
  const started = await startPageVoice(
    async (body) => {
      calls.push({ status: body.status, hasAudio: Boolean(body.audio) });
      return { sessionId: "s1", text: body.status === 2 ? "打开仓库" : "打开" };
    },
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
  assert.deepEqual(calls, [
    { status: 0, hasAudio: true },
    { status: 2, hasAudio: false },
  ]);
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

test("transcribePcm posts the whole clip then finalizes", async () => {
  const { transcribePcm } = await import("./page.js");
  const calls: Array<{ status: number; bytes: number }> = [];
  const result = await transcribePcm(
    async (body) => {
      calls.push({ status: body.status, bytes: body.audio ? atob(body.audio).length : 0 });
      return { sessionId: "s1", text: body.status === 2 ? "你好" : "" };
    },
    Uint8Array.from([1, 0, 2, 0, 3, 0, 4, 0]),
    () => undefined,
  );
  assert.equal(result.kind, "transcript");
  if (result.kind !== "transcript") throw new Error("expected transcript");
  assert.equal(result.text, "你好");
  assert.deepEqual(calls, [
    { status: 0, bytes: 8 },
    { status: 2, bytes: 0 },
  ]);
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

test("startPageVoice rejects a video from the iOS media sheet", async () => {
  const started = await startPageVoice(
    async () => ({ sessionId: "s1", text: "" }),
    () => undefined,
    undefined,
    undefined,
    {
      allowLiveMic: false,
      pickFile: async () => new File([Uint8Array.from([1])], "clip.mov", { type: "video/quicktime" }),
    },
  );
  assert.deepEqual(started, { kind: "error", message: NOT_AUDIO_FILE_HINT });
});

test("startPageVoice maps a broken file to a recording hint", async () => {
  const started = await startPageVoice(
    async () => ({ sessionId: "s1", text: "" }),
    () => undefined,
    undefined,
    undefined,
    {
      allowLiveMic: false,
      pickFile: async () => new File([Uint8Array.from([1])], "a.wav", { type: "audio/wav" }),
      decodeFile: async () => {
        throw new Error("Unable to decode");
      },
    },
  );
  assert.deepEqual(started, { kind: "error", message: BAD_RECORDING_HINT });
});

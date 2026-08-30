import assert from "node:assert/strict";
import test from "node:test";
import { concatPcm, describeSpeechError, IAT_HTTP_MIN_BYTES, pcmToBase64, startCloudVoice } from "./cloud.js";

test("pcmToBase64 encodes raw bytes", () => {
  assert.equal(pcmToBase64(Uint8Array.from([0, 1, 2])), btoa("\u0000\u0001\u0002"));
});

test("startCloudVoice streams frames then finalizes on stop", async () => {
  const calls: Array<{ status: number; audio?: string }> = [];
  const push = async (body: { sessionId?: string; audio?: string; status: 0 | 1 | 2 }) => {
    calls.push({ status: body.status, audio: body.audio });
    return { sessionId: "s1", text: body.status === 2 ? "你好世界" : "你好" };
  };
  let emit: ((pcm: Uint8Array) => void) | null = null;
  const started = await startCloudVoice(
    push,
    {
      start: async (onFrame) => {
        emit = onFrame;
      },
      stop: async () => undefined,
    },
    () => undefined,
    undefined,
    undefined,
    { minHttpBytes: 1 },
  );
  assert.equal(started.kind, "session");
  emit?.(Uint8Array.from([1, 0, 2, 0]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  if (started.kind !== "session") throw new Error("expected session");
  const spoken = await started.session.stop();
  assert.equal(spoken, "你好世界");
  assert.equal(calls[0]?.status, 0);
  assert.equal(calls.at(-1)?.status, 2);
});

test("describeSpeechError maps rate_limited to a single Chinese hint", () => {
  assert.equal(describeSpeechError("rate_limited"), "听写请求太密，请稍后再试。");
  assert.equal(describeSpeechError("听写服务不可用"), "听写服务不可用");
});

test("startCloudVoice reports the first push error once and stops the mic", async () => {
  let pushes = 0;
  let stops = 0;
  const errors: string[] = [];
  const push = async () => {
    pushes += 1;
    throw new Error("rate_limited");
  };
  let emit: ((pcm: Uint8Array) => void) | null = null;
  const started = await startCloudVoice(
    push,
    {
      start: async (onFrame) => {
        emit = onFrame;
      },
      stop: async () => {
        stops += 1;
      },
    },
    () => undefined,
    (message) => errors.push(message),
    undefined,
    { minHttpBytes: 1 },
  );
  assert.equal(started.kind, "session");
  emit?.(Uint8Array.from([1, 0]));
  emit?.(Uint8Array.from([2, 0]));
  emit?.(Uint8Array.from([3, 0]));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(errors.length, 1);
  assert.equal(errors[0], "听写请求太密，请稍后再试。");
  assert.equal(stops, 1);
  assert.ok(pushes >= 1);
});

test("startCloudVoice batches mic frames into fewer HTTP posts", async () => {
  const calls: Array<{ status: number; bytes: number }> = [];
  const push = async (body: { audio?: string; status: 0 | 1 | 2 }) => {
    calls.push({ status: body.status, bytes: body.audio ? atob(body.audio).length : 0 });
    return { sessionId: "s1", text: "" };
  };
  let emit: ((pcm: Uint8Array) => void) | null = null;
  const started = await startCloudVoice(
    push,
    {
      start: async (onFrame) => {
        emit = onFrame;
      },
      stop: async () => undefined,
    },
    () => undefined,
    undefined,
    undefined,
    { minHttpBytes: 4 },
  );
  assert.equal(started.kind, "session");
  emit?.(Uint8Array.from([1, 0]));
  emit?.(Uint8Array.from([2, 0]));
  emit?.(Uint8Array.from([3, 0]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.status, 0);
  assert.equal(calls[0]?.bytes, 4);
  if (started.kind !== "session") throw new Error("expected session");
  await started.session.stop();
  assert.equal(calls.at(-2)?.status, 1);
  assert.equal(calls.at(-2)?.bytes, 2);
  assert.equal(calls.at(-1)?.status, 2);
  assert.equal(IAT_HTTP_MIN_BYTES, 6400);
  assert.equal(concatPcm([Uint8Array.from([1]), Uint8Array.from([2, 3])]).length, 3);
});

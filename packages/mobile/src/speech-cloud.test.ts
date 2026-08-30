import assert from "node:assert/strict";
import test from "node:test";
import { pcmToBase64, startCloudVoice } from "./speech-cloud.js";

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

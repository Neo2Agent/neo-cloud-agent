import assert from "node:assert/strict";
import test from "node:test";
import { BAD_RECORDING_HINT } from "./cloud.js";
import { AUDIO_FILE_ACCEPT, decodeAudioFileToPcm, pickAudioFile } from "./file.js";

test("decodeAudioFileToPcm uses the injected decoder", async () => {
  const file = new File([Uint8Array.from([1, 2, 3])], "a.wav", { type: "audio/wav" });
  const pcm = await decodeAudioFileToPcm(file, async () => ({
    numberOfChannels: 1,
    sampleRate: 16_000,
    getChannelData: () => Float32Array.from([0, 1, -1]),
  }));
  assert.equal(pcm.length, 6);
  const view = new DataView(pcm.buffer);
  assert.equal(view.getInt16(2, true), 0x7fff);
  assert.equal(view.getInt16(4, true), -0x8000);
});

test("decodeAudioFileToPcm maps decoder failures to a file hint", async () => {
  const file = new File([Uint8Array.from([1])], "a.amr", { type: "audio/amr" });
  await assert.rejects(
    decodeAudioFileToPcm(file, async () => {
      throw new Error("Unable to decode");
    }),
    (error: unknown) => error instanceof Error && error.message === BAD_RECORDING_HINT,
  );
});

test("pickAudioFile resolves the chosen file", async () => {
  let change: (() => void) | undefined;
  const attrs: Record<string, string> = {};
  const chosen = new File([Uint8Array.from([9])], "voice.m4a", { type: "audio/mp4" });
  const input = {
    type: "",
    accept: "",
    files: [chosen] as unknown as FileList,
    setAttribute(name: string, value: string) {
      attrs[name] = value;
    },
    addEventListener(name: string, fn: () => void) {
      if (name === "change") change = fn;
    },
    click() {
      change?.();
    },
  };
  const file = await pickAudioFile({
    createElement: () => input as unknown as HTMLInputElement,
  });
  assert.equal(file?.name, "voice.m4a");
  assert.equal(input.accept, AUDIO_FILE_ACCEPT);
  assert.equal(attrs.capture, undefined);
});

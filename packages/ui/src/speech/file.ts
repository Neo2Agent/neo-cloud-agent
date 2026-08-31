import { BAD_RECORDING_HINT } from "./cloud";
import { floatTo16Bit } from "./pcm";

export type DecodedAudio = {
  numberOfChannels: number;
  sampleRate: number;
  getChannelData: (channel: number) => Float32Array;
};

export type FilePickerDoc = {
  createElement: (tag: string) => HTMLInputElement;
};

const CANCEL_AFTER_FOCUS_MS = 1_200;

async function defaultDecodeAudio(buffer: ArrayBuffer): Promise<DecodedAudio> {
  const Win = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Ctx = Win.AudioContext ?? Win.webkitAudioContext;
  if (!Ctx) throw new Error(BAD_RECORDING_HINT);
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(buffer.slice(0));
  } catch {
    throw new Error(BAD_RECORDING_HINT);
  } finally {
    await ctx.close();
  }
}

export async function decodeAudioFileToPcm(
  file: Blob,
  decode: (buffer: ArrayBuffer) => Promise<DecodedAudio> = defaultDecodeAudio,
): Promise<Uint8Array> {
  try {
    const audio = await decode(await file.arrayBuffer());
    if (!audio.numberOfChannels) return new Uint8Array();
    return floatTo16Bit(audio.getChannelData(0), audio.sampleRate || 16_000);
  } catch (error) {
    if (error instanceof Error && error.message === BAD_RECORDING_HINT) throw error;
    throw new Error(BAD_RECORDING_HINT);
  }
}

/** Audio-only. Do not set `capture` — on phone browsers that opens the camera. */
export const AUDIO_FILE_ACCEPT =
  "audio/*,audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/aac,audio/x-m4a,.mp3,.m4a,.wav,.aac,.ogg";

export function pickAudioFile(doc: FilePickerDoc = document): Promise<File | null> {
  return new Promise((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = AUDIO_FILE_ACCEPT;
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    const win = typeof window === "undefined" ? undefined : window;
    win?.addEventListener(
      "focus",
      () => {
        win.setTimeout(() => finish(null), CANCEL_AFTER_FOCUS_MS);
      },
      { once: true },
    );
    input.click();
  });
}

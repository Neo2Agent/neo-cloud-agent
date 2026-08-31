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

/**
 * Extensions only. Do not set `capture`, and do not use `audio/*` / `audio/mp4` /
 * `audio/webm` — iOS Safari treats those as video and offers 录像 / 照片图库.
 */
export const AUDIO_FILE_ACCEPT = ".mp3,.wav,.aac,.m4a";

export const NOT_AUDIO_FILE_HINT = "这是照片或视频。请选录音文件（m4a / mp3 / wav），不要点「录像」或相册。";

const AUDIO_NAME = /\.(mp3|wav|aac|m4a|ogg|flac)$/i;

export function isLikelyAudioFile(file: { name?: string; type?: string }): boolean {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("video/") || type.startsWith("image/")) return false;
  if (type.startsWith("audio/")) return true;
  const name = file.name || "";
  if (/\.(mp4|mov|m4v|avi|mkv|webm|jpg|jpeg|png|gif|heic|heif|webp)$/i.test(name)) return false;
  return AUDIO_NAME.test(name);
}

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

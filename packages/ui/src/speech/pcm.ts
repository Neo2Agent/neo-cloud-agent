import { INSECURE_MIC_HINT, UNSUPPORTED_MIC_HINT, type PcmCapture } from "./cloud";

const TARGET_RATE = 16_000;

type LegacyGetUserMedia = (
  constraints: MediaStreamConstraints,
  success: (stream: MediaStream) => void,
  failure: (error: Error) => void,
) => void;

export type MicNavigator = Pick<Navigator, "mediaDevices"> & {
  getUserMedia?: LegacyGetUserMedia;
  webkitGetUserMedia?: LegacyGetUserMedia;
  mozGetUserMedia?: LegacyGetUserMedia;
};

export function resolveGetUserMedia(
  nav?: MicNavigator | null,
): ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null {
  const resolved = nav ?? (typeof navigator === "undefined" ? null : (navigator as MicNavigator));
  if (!resolved) return null;
  const modern = resolved.mediaDevices?.getUserMedia;
  if (typeof modern === "function") {
    return (constraints) => modern.call(resolved.mediaDevices, constraints);
  }
  const legacy = resolved.getUserMedia ?? resolved.webkitGetUserMedia ?? resolved.mozGetUserMedia;
  if (typeof legacy !== "function") return null;
  return (constraints) =>
    new Promise((resolve, reject) => {
      legacy.call(resolved, constraints, resolve, reject);
    });
}

export function pageAllowsLiveMic(
  win: Pick<Window, "navigator"> = globalThis as unknown as Window,
): boolean {
  return resolveGetUserMedia(win.navigator as MicNavigator) !== null;
}

export function browserMicReady(
  win: Pick<Window, "isSecureContext" | "navigator"> = globalThis as unknown as Window,
): string | null {
  if (pageAllowsLiveMic(win)) return null;
  if (win.isSecureContext === false) return INSECURE_MIC_HINT;
  return UNSUPPORTED_MIC_HINT;
}

export function floatTo16Bit(input: Float32Array, fromRate: number): Uint8Array {
  const ratio = fromRate / TARGET_RATE;
  const length = Math.max(1, Math.round(input.length / ratio));
  const bytes = new Uint8Array(length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < length; i += 1) {
    const sample = input[Math.min(input.length - 1, Math.floor(i * ratio))] ?? 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return bytes;
}

export async function startBrowserPcm(onFrame: (pcm: Uint8Array) => void): Promise<() => Promise<void>> {
  const blocked = browserMicReady();
  if (blocked) throw new Error(blocked);
  const getUserMedia = resolveGetUserMedia();
  if (!getUserMedia) throw new Error(UNSUPPORTED_MIC_HINT);
  const context = new AudioContext({ sampleRate: TARGET_RATE });
  const stream = await getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(2048, 1, 1);
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    onFrame(floatTo16Bit(input, context.sampleRate || TARGET_RATE));
  };
  source.connect(processor);
  processor.connect(context.destination);
  return async () => {
    processor.disconnect();
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
  };
}

export function createBrowserPcmCapture(): PcmCapture {
  let stop: (() => Promise<void>) | null = null;
  return {
    start: async (onFrame) => {
      stop = await startBrowserPcm(onFrame);
    },
    stop: async () => {
      await stop?.();
      stop = null;
    },
  };
}

import {
  BAD_RECORDING_HINT,
  EMPTY_RECORDING_HINT,
  IAT_HTTP_MIN_BYTES,
  startCloudVoice,
  type PcmCapture,
  type SpeechIatPush,
  type StartVoiceResult,
} from "./cloud";
import { decodeAudioFileToPcm, pickAudioFile } from "./file";
import { createBrowserPcmCapture, pageAllowsLiveMic } from "./pcm";

export type StartPageVoiceDeps = {
  allowLiveMic?: boolean;
  pickFile?: () => Promise<File | null>;
  decodeFile?: (file: Blob) => Promise<Uint8Array>;
  liveCapture?: PcmCapture;
};

export async function transcribePcm(
  push: SpeechIatPush,
  pcm: Uint8Array,
  onPreview: (text: string) => void,
  onError?: (message: string) => void,
): Promise<StartVoiceResult> {
  let emit: ((frame: Uint8Array) => void) | null = null;
  const started = await startCloudVoice(
    push,
    {
      start: async (onFrame) => {
        emit = onFrame;
      },
      stop: async () => undefined,
    },
    onPreview,
    onError,
    undefined,
    { minHttpBytes: IAT_HTTP_MIN_BYTES },
  );
  if (started.kind !== "session") return started;
  const chunk = IAT_HTTP_MIN_BYTES;
  for (let offset = 0; offset < pcm.length; offset += chunk) {
    emit?.(pcm.subarray(offset, Math.min(pcm.length, offset + chunk)));
  }
  const text = (await started.session.stop()).replace(/\s+/g, " ").trim();
  if (!text) return { kind: "error", message: EMPTY_RECORDING_HINT };
  return { kind: "transcript", text };
}

export async function startPageVoice(
  push: SpeechIatPush,
  onPreview: (text: string) => void,
  onError?: (message: string) => void,
  onEnded?: () => void,
  deps: StartPageVoiceDeps = {},
): Promise<StartVoiceResult> {
  const allowLiveMic = deps.allowLiveMic ?? pageAllowsLiveMic();
  if (allowLiveMic) {
    return startCloudVoice(push, deps.liveCapture ?? createBrowserPcmCapture(), onPreview, onError, onEnded);
  }
  const file = await (deps.pickFile ?? pickAudioFile)();
  if (!file) return { kind: "cancelled" };
  try {
    const pcm = await (deps.decodeFile ?? decodeAudioFileToPcm)(file);
    if (!pcm.length) return { kind: "error", message: EMPTY_RECORDING_HINT };
    return await transcribePcm(push, pcm, onPreview, onError);
  } catch (error) {
    const message = error instanceof Error ? error.message : BAD_RECORDING_HINT;
    return { kind: "error", message: message === EMPTY_RECORDING_HINT ? message : BAD_RECORDING_HINT };
  }
}

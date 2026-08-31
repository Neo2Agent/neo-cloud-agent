import {
  BAD_RECORDING_HINT,
  EMPTY_RECORDING_HINT,
  describeSpeechError,
  pcmToBase64,
  startCloudVoice,
  type PcmCapture,
  type SpeechIatPush,
  type StartVoiceResult,
} from "./cloud";
import { decodeAudioFileToPcm, isLikelyAudioFile, NOT_AUDIO_FILE_HINT, pickAudioFile } from "./file";
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
  try {
    const opened = await push({ status: 0, audio: pcmToBase64(pcm) });
    if (opened.error) throw new Error(opened.error);
    if (opened.text) onPreview(opened.text);
    const done = await push({ status: 2, sessionId: opened.sessionId });
    if (done.error) throw new Error(done.error);
    const text = (done.text || opened.text || "").replace(/\s+/g, " ").trim();
    if (!text) return { kind: "error", message: EMPTY_RECORDING_HINT };
    onPreview(text);
    return { kind: "transcript", text };
  } catch (error) {
    const message = describeSpeechError(error instanceof Error ? error.message : EMPTY_RECORDING_HINT);
    onError?.(message);
    return { kind: "error", message };
  }
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
  if (!isLikelyAudioFile(file)) return { kind: "error", message: NOT_AUDIO_FILE_HINT };
  try {
    const pcm = await (deps.decodeFile ?? decodeAudioFileToPcm)(file);
    if (!pcm.length) return { kind: "error", message: EMPTY_RECORDING_HINT };
    return await transcribePcm(push, pcm, onPreview, onError);
  } catch (error) {
    const message = error instanceof Error ? error.message : BAD_RECORDING_HINT;
    return { kind: "error", message: message === EMPTY_RECORDING_HINT ? message : BAD_RECORDING_HINT };
  }
}

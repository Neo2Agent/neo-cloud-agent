import {
  pageAllowsLiveMic,
  pickAudioFile,
  startPageVoice,
  type PcmCapture,
  type StartVoiceResult,
} from "@neo-cloud-agent/ui/speech";
import { speechIat, speechStatus } from "./api";

export function finishClickVoice(spoken: string): string {
  return spoken.replace(/\s+/g, " ").trim();
}

export function applyClickVoice(current: string, spoken: string): string {
  const next = finishClickVoice(spoken);
  if (!next) return current;
  const base = current.replace(/\s+/g, " ").trim();
  return base ? `${base} ${next}` : next;
}

export type StartDeskVoiceDeps = {
  allowLiveMic?: boolean;
  pickFile?: () => Promise<File | null>;
  decodeFile?: (file: Blob) => Promise<Uint8Array>;
  liveCapture?: PcmCapture;
};

export async function startDeskVoice(
  token: string,
  onPreview: (text: string) => void,
  onError?: (message: string) => void,
  onEnded?: () => void,
  deps: StartDeskVoiceDeps = {},
): Promise<StartVoiceResult> {
  const allowLiveMic = deps.allowLiveMic ?? pageAllowsLiveMic();
  const picking = allowLiveMic
    ? undefined
    : (deps.pickFile ?? (typeof document === "undefined" ? async () => null : pickAudioFile))();
  try {
    const status = await speechStatus(token);
    if (!status.configured) {
      return { kind: "error", message: "听写未配置。把讯飞 APPID / APIKey / APISecret 写到服务器后再试。" };
    }
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "听写服务不可用" };
  }
  return startPageVoice((body) => speechIat(token, body), onPreview, onError, onEnded, {
    allowLiveMic,
    pickFile: picking ? async () => picking : deps.pickFile,
    decodeFile: deps.decodeFile,
    liveCapture: deps.liveCapture,
  });
}

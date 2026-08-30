import { createBrowserPcmCapture, startCloudVoice, type StartVoiceResult } from "@neo-cloud-agent/ui/speech";
import { speechIat, speechStatus } from "./api";

/** Second click returns spoken text for the composer. Never sends. */
export function finishClickVoice(spoken: string): string {
  return spoken.replace(/\s+/g, " ").trim();
}

export function applyClickVoice(current: string, spoken: string): string {
  const next = finishClickVoice(spoken);
  if (!next) return current;
  const base = current.replace(/\s+/g, " ").trim();
  return base ? `${base} ${next}` : next;
}

export async function startWebVoice(
  token: string,
  onPreview: (text: string) => void,
  onError?: (message: string) => void,
  onEnded?: () => void,
): Promise<StartVoiceResult> {
  try {
    const status = await speechStatus(token);
    if (!status.configured) {
      return { kind: "error", message: "听写未配置。把讯飞 APPID / APIKey / APISecret 写到服务器后再试。" };
    }
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "听写服务不可用" };
  }
  return startCloudVoice((body) => speechIat(token, body), createBrowserPcmCapture(), onPreview, onError, onEnded);
}

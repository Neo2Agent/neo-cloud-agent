import type { MobileClient } from "./api/client";
import { createBrowserPcmCapture } from "./pcm";
import { startCloudVoice, type StartVoiceResult } from "./speech-cloud";

export async function startAppVoice(
  client: MobileClient,
  onPreview: (text: string) => void,
  onError?: (message: string) => void,
  onEnded?: () => void,
  captureFactory?: () => Promise<import("./speech-cloud").PcmCapture>,
): Promise<StartVoiceResult> {
  try {
    const status = await client.speechStatus();
    if (!status.configured) {
      return { kind: "error", message: "听写未配置。把讯飞 APPID / APIKey / APISecret 写到服务器后再试。" };
    }
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "听写服务不可用" };
  }
  const capture = captureFactory ? await captureFactory() : createBrowserPcmCapture();
  return startCloudVoice((body) => client.speechIat(body), capture, onPreview, onError, onEnded);
}

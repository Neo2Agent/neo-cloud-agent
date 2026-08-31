import { pageAllowsLiveMic, pickAudioFile, startPageVoice } from "@neo-cloud-agent/ui/speech";
import type { MobileClient } from "./api/client";
import { startCloudVoice, type StartVoiceResult } from "./speech-cloud";

export async function startAppVoice(
  client: MobileClient,
  onPreview: (text: string) => void,
  onError?: (message: string) => void,
  onEnded?: () => void,
  captureFactory?: () => Promise<import("./speech-cloud").PcmCapture>,
): Promise<StartVoiceResult> {
  const push = (body: Parameters<MobileClient["speechIat"]>[0]) => client.speechIat(body);
  if (captureFactory) {
    try {
      const status = await client.speechStatus();
      if (!status.configured) {
        return { kind: "error", message: "听写未配置。把讯飞 APPID / APIKey / APISecret 写到服务器后再试。" };
      }
    } catch (error) {
      return { kind: "error", message: error instanceof Error ? error.message : "听写服务不可用" };
    }
    return startCloudVoice(push, await captureFactory(), onPreview, onError, onEnded);
  }
  const allowLiveMic = pageAllowsLiveMic();
  const picking = allowLiveMic
    ? undefined
    : (typeof document === "undefined" ? async () => null : pickAudioFile)();
  try {
    const status = await client.speechStatus();
    if (!status.configured) {
      return { kind: "error", message: "听写未配置。把讯飞 APPID / APIKey / APISecret 写到服务器后再试。" };
    }
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "听写服务不可用" };
  }
  return startPageVoice(push, onPreview, onError, onEnded, {
    allowLiveMic,
    pickFile: picking ? async () => picking : undefined,
  });
}

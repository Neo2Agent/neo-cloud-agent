import type { MobileClient } from "../api/client";
import { startAppVoice } from "../start-voice";
import type { StartVoiceResult } from "../speech-cloud";
import { createNativePcmCapture } from "./pcm-recorder";

export async function startNativeVoice(
  client: MobileClient,
  onPreview: (text: string) => void,
  onError?: (message: string) => void,
  onEnded?: () => void,
): Promise<StartVoiceResult> {
  return startAppVoice(client, onPreview, onError, onEnded, createNativePcmCapture);
}

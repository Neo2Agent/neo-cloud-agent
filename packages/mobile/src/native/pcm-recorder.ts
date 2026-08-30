import { PermissionsAndroid, Platform } from "react-native";
import type { PcmCapture } from "../speech-cloud";

type NativeRecorder = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  addListener: (event: string, listener: (payload: { pcm?: string }) => void) => { remove: () => void };
};

async function loadNative(): Promise<NativeRecorder | null> {
  try {
    const expo = await import("expo-modules-core");
    const required = (expo as { requireOptionalNativeModule?: (name: string) => NativeRecorder | null })
      .requireOptionalNativeModule?.("NeoPcmRecorder");
    return required ?? null;
  } catch {
    return null;
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function createNativePcmCapture(): Promise<PcmCapture> {
  const native = await loadNative();
  if (!native) {
    throw new Error("听写服务不可用");
  }
  let sub: { remove: () => void } | null = null;
  return {
    start: async (onFrame) => {
      if (Platform.OS === "android") {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          throw new Error("请允许麦克风后再试。");
        }
      }
      sub = native.addListener("audio", (payload) => {
        if (payload.pcm) onFrame(decodeBase64(payload.pcm));
      });
      await native.start();
    },
    stop: async () => {
      try {
        await native.stop();
      } finally {
        sub?.remove();
        sub = null;
      }
    },
  };
}

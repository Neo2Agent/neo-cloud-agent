import type { VoiceSession } from "../voice";

export async function startNativeVoice(onPreview: (text: string) => void): Promise<VoiceSession | null> {
  try {
    const { ExpoSpeechRecognitionModule } = await import("expo-speech-recognition");
    const mic = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
    if (!mic.granted) return null;
    let finalText = "";
    const subs = [
      ExpoSpeechRecognitionModule.addListener("result", (event) => {
        const transcript = event.results?.[0]?.transcript ?? "";
        if (event.isFinal && transcript) finalText = transcript;
        onPreview(transcript || finalText);
      }),
      ExpoSpeechRecognitionModule.addListener("error", () => undefined),
    ];
    ExpoSpeechRecognitionModule.start({
      lang: "zh-CN",
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
    });
    return {
      stop: async () => {
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          try {
            ExpoSpeechRecognitionModule.abort();
          } catch {
            /* ignore */
          }
        }
        for (const sub of subs) sub.remove();
        return finalText.replace(/\s+/g, " ").trim();
      },
    };
  } catch {
    return null;
  }
}

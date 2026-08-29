import { browserSpeechCtor, startSpeechRecognition, type SpeechSession } from "@neo-cloud-agent/ui";

export function browserVoiceSupported(win: Window = window): boolean {
  return Boolean(browserSpeechCtor(win));
}

export function startBrowserVoice(onPreview: (text: string) => void, win: Window = window): SpeechSession | null {
  const ctor = browserSpeechCtor(win);
  if (!ctor) return null;
  try {
    return startSpeechRecognition(new ctor(), onPreview);
  } catch {
    return null;
  }
}

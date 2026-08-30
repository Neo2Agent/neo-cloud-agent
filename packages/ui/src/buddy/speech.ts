export const HOLD_MS = 280;

export function classifyPointer(durationMs: number, threshold = HOLD_MS): "tap" | "hold" {
  return durationMs >= threshold ? "hold" : "tap";
}

const SPOKEN_PUNCT = /^[\s\p{P}\p{S}]+$/u;

export function isSpokenPunctuation(text: string): boolean {
  return Boolean(text) && SPOKEN_PUNCT.test(text);
}

/** Keep the sentence when a later packet is only 「？」. */
export function preferSpokenText(current: string, incoming: string): string {
  const next = incoming.replace(/\s+/g, " ").trim();
  const prev = current.replace(/\s+/g, " ").trim();
  if (!next) return prev;
  if (!prev) return next;
  if (isSpokenPunctuation(next)) return prev.endsWith(next) ? prev : `${prev}${next}`;
  if (next.length + 2 < prev.length && !next.includes(prev.slice(0, Math.min(2, prev.length)))) {
    return prev;
  }
  return next;
}

export function mergeSpokenText(current: string, spoken: string): string {
  const next = spoken.replace(/\s+/g, " ").trim();
  if (!next) return current;
  const base = current.replace(/\s+/g, " ").trim();
  return base ? `${base} ${next}` : next;
}

export function modelShortLabel(model: string): string {
  return /pro/i.test(model) && !/vision/i.test(model) ? "Pro" : "Flash";
}

export function holdPadLabel(input: { supported: boolean; holding: boolean; followUp?: boolean }): string {
  if (input.holding) return "正在听…";
  if (!input.supported) return input.followUp ? "继续说一句…" : "说说你要做什么";
  return "按住 说话";
}

export type SpeechResultEvent = {
  results: ArrayLike<{ isFinal?: boolean; 0: { transcript: string } }>;
};

export type SpeechEngine = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export type SpeechSession = {
  stop: () => Promise<string>;
};

export function collectSpeechTranscript(results: SpeechResultEvent["results"]): { finalText: string; preview: string } {
  let finalText = "";
  let interim = "";
  for (let index = 0; index < results.length; index += 1) {
    const item = results[index];
    const piece = item?.[0]?.transcript ?? "";
    if (item?.isFinal) finalText += piece;
    else interim += piece;
  }
  return { finalText, preview: `${finalText}${interim}`.replace(/\s+/g, " ").trim() };
}

export function startSpeechRecognition(engine: SpeechEngine, onPreview?: (text: string) => void): SpeechSession {
  let finalText = "";
  let preview = "";
  engine.lang = "zh-CN";
  engine.interimResults = true;
  engine.continuous = true;
  engine.onresult = (event) => {
    const next = collectSpeechTranscript(event.results);
    if (next.finalText) finalText = preferSpokenText(finalText, next.finalText);
    preview = preferSpokenText(preview, next.preview || next.finalText);
    onPreview?.(preview || finalText);
  };
  engine.start();
  return {
    stop: () =>
      new Promise((resolve) => {
        const finish = () => resolve(preferSpokenText(finalText, preview).replace(/\s+/g, " ").trim());
        engine.onend = finish;
        try {
          engine.stop();
        } catch {
          finish();
        }
      }),
  };
}

export function browserSpeechCtor(
  win: Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown },
): (new () => SpeechEngine) | null {
  const ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as new () => SpeechEngine) : null;
}

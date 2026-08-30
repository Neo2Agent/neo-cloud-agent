export type VoiceSession = {
  stop: () => Promise<string>;
};

export type StartVoiceResult =
  | { kind: "session"; session: VoiceSession }
  | { kind: "error"; message: string };

const SPOKEN_PUNCT = /^[\s\p{P}\p{S}]+$/u;

export function isSpokenPunctuation(text: string): boolean {
  return Boolean(text) && SPOKEN_PUNCT.test(text);
}

/** Keep the sentence when a later IAT/WebSpeech packet is only 「？」. */
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

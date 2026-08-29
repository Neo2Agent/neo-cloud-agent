export type VoiceSession = {
  stop: () => Promise<string>;
};

export function mergeSpokenText(current: string, spoken: string): string {
  const next = spoken.replace(/\s+/g, " ").trim();
  if (!next) return current;
  const base = current.replace(/\s+/g, " ").trim();
  return base ? `${base} ${next}` : next;
}

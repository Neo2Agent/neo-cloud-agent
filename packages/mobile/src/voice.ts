export type VoiceSession = {
  stop: () => Promise<string>;
};

export type StartVoiceResult =
  | { kind: "session"; session: VoiceSession }
  | { kind: "error"; message: string };

export function mergeSpokenText(current: string, spoken: string): string {
  const next = spoken.replace(/\s+/g, " ").trim();
  if (!next) return current;
  const base = current.replace(/\s+/g, " ").trim();
  return base ? `${base} ${next}` : next;
}

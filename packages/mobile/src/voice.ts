export type VoiceSession = {
  stop: () => Promise<string>;
};

export type StartVoiceResult =
  | { kind: "session"; session: VoiceSession }
  | { kind: "error"; message: string };

/** Same threshold as ui `HOLD_MS`. Kept here so tests do not load the ui barrel. */
export const HOLD_VOICE_MS = 280;

export function mergeSpokenText(current: string, spoken: string): string {
  const next = spoken.replace(/\s+/g, " ").trim();
  if (!next) return current;
  const base = current.replace(/\s+/g, " ").trim();
  return base ? `${base} ${next}` : next;
}

export function isVoiceHoldTap(heldMs: number, thresholdMs = HOLD_VOICE_MS): boolean {
  return heldMs < thresholdMs;
}

/** Tap discards dictation. Hold returns the spoken text. Never sends. */
export function finishHoldVoice(input: { heldMs: number; spoken: string; thresholdMs?: number }): string {
  if (isVoiceHoldTap(input.heldMs, input.thresholdMs ?? HOLD_VOICE_MS)) return "";
  return input.spoken.replace(/\s+/g, " ").trim();
}

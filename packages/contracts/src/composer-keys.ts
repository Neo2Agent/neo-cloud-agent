import type { FollowUpDelivery } from "./run.js";

export type ImeKeyState = { isComposing?: boolean; keyCode?: number };

export type ComposerKeyEvent = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
} & ImeKeyState;

/** `send` starts a turn; `queue` waits for the running turn; `steer` lands at the next tool call. */
export type ComposerKeyAction = "send" | "queue" | "steer";

/** Enter that confirms an IME candidate (pinyin etc.) must not submit. Safari reports it only as keyCode 229. */
export function isImeComposing(event: ImeKeyState): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

/**
 * Cursor semantics. Idle: Enter or Mod+Enter sends. Running: Enter queues, Mod+Enter steers.
 * Shift+Enter is a newline. On a phone plain Enter is a newline too; the button sends.
 */
export function composerKeyAction(
  event: ComposerKeyEvent,
  state: { busy: boolean; narrow?: boolean },
): ComposerKeyAction | null {
  if (event.key !== "Enter" || isImeComposing(event) || event.shiftKey || event.altKey) {
    return null;
  }
  const mod = Boolean(event.ctrlKey || event.metaKey);
  if (mod) {
    return state.busy ? "steer" : "send";
  }
  if (state.narrow) {
    return null;
  }
  return state.busy ? "queue" : "send";
}

/** Follow-up delivery for a composer action while a turn is open. `send` lets the control plane pick. */
export function followUpDelivery(action: ComposerKeyAction): FollowUpDelivery | undefined {
  if (action === "queue") return "follow_up";
  if (action === "steer") return "steer";
  return undefined;
}

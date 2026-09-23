import { isImeComposing, type ImeKeyState } from "./viewport";

export type ShortcutAction =
  | "new-chat"
  | "prev-run"
  | "next-run"
  | "cycle-model"
  | "queue"
  | "stop"
  | "close";

export function shortcutAction(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean } & ImeKeyState,
  platform: "darwin" | "other" = "other",
): ShortcutAction | null {
  if (isImeComposing(event)) {
    return null;
  }
  const mod = platform === "darwin" ? event.metaKey : event.ctrlKey;
  if (event.key === "Enter" && event.ctrlKey && !event.shiftKey) {
    return "queue";
  }
  if (!mod) {
    return null;
  }
  if (event.key === "t" || event.key === "T") return "new-chat";
  if (event.key === "[") return "prev-run";
  if (event.key === "]") return "next-run";
  if (event.key === "/" && !event.altKey) return "cycle-model";
  if (event.key === "Backspace" && event.shiftKey) return "stop";
  if (event.key === "w" || event.key === "W") return "close";
  return null;
}

export function cycle<T>(items: readonly T[], current: T): T {
  const index = items.indexOf(current);
  return items[(index + 1) % items.length] ?? current;
}

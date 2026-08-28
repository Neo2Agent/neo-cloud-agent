export type ShortcutAction =
  | "new-chat"
  | "prev-run"
  | "next-run"
  | "mode-menu"
  | "cycle-model"
  | "cycle-mode"
  | "queue"
  | "stop"
  | "close";

export function shortcutAction(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  platform: "darwin" | "other" = "other",
): ShortcutAction | null {
  const mod = platform === "darwin" ? event.metaKey : event.ctrlKey;
  if (event.key === "Enter" && event.ctrlKey && !event.shiftKey) {
    return "queue";
  }
  if (event.key === "Tab" && event.shiftKey && !mod) {
    return "cycle-mode";
  }
  if (!mod) {
    return null;
  }
  if (event.key === "t" || event.key === "T") return "new-chat";
  if (event.key === "[") return "prev-run";
  if (event.key === "]") return "next-run";
  if (event.key === ".") return "mode-menu";
  if (event.key === "/" && !event.altKey) return "cycle-model";
  if (event.key === "Backspace" && event.shiftKey) return "stop";
  if (event.key === "w" || event.key === "W") return "close";
  return null;
}

export function cycle<T>(items: readonly T[], current: T): T {
  const index = items.indexOf(current);
  return items[(index + 1) % items.length] ?? current;
}

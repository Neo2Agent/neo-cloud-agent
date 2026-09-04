export type TermKeyAction = "ignore" | "submit" | "interrupt" | "clear" | "history-prev" | "history-next";

export function termKeyAction(input: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  composing?: boolean;
}): TermKeyAction {
  if (input.composing) {
    return "ignore";
  }
  if (input.key === "Enter") {
    return "submit";
  }
  if ((input.ctrlKey || input.metaKey) && input.key.toLowerCase() === "c") {
    return "interrupt";
  }
  if ((input.ctrlKey || input.metaKey) && input.key.toLowerCase() === "l") {
    return "clear";
  }
  if (input.key === "ArrowUp" && !input.altKey) {
    return "history-prev";
  }
  if (input.key === "ArrowDown" && !input.altKey) {
    return "history-next";
  }
  return "ignore";
}

export function nextHistoryIndex(
  action: "history-prev" | "history-next",
  current: number,
  length: number,
): number {
  if (length === 0) {
    return -1;
  }
  if (action === "history-prev") {
    if (current < 0) {
      return length - 1;
    }
    return Math.max(0, current - 1);
  }
  if (current < 0 || current >= length - 1) {
    return -1;
  }
  return current + 1;
}

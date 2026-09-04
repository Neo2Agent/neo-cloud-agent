export type TermKeyAction = "ignore" | "submit" | "interrupt" | "clear" | "history-prev" | "history-next";

export type TermKeyInput = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  composing?: boolean;
};

export function termKeyAction(input: TermKeyInput): TermKeyAction {
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

/** Bytes to send into a real PTY. `null` means the browser should keep the key. */
export function termKeyBytes(input: TermKeyInput): string | null {
  if (input.composing) {
    return null;
  }
  const key = input.key;
  if (input.ctrlKey || input.metaKey) {
    const letter = key.length === 1 ? key.toLowerCase() : "";
    if (letter === "c") return "\x03";
    if (letter === "d") return "\x04";
    if (letter === "l") return "\x0c";
    if (letter === "a") return "\x01";
    if (letter === "e") return "\x05";
    if (letter === "u") return "\x15";
    if (letter === "k") return "\x0b";
    if (letter === "w") return "\x17";
    if (letter === "r") return "\x12";
    if (letter === "z") return "\x1a";
    return null;
  }
  if (input.altKey && key.length === 1) {
    return `\x1b${key}`;
  }
  switch (key) {
    case "Enter":
      return "\r";
    case "Tab":
      return "\t";
    case "Backspace":
      return "\x7f";
    case "Delete":
      return "\x1b[3~";
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
    case "Escape":
      return "\x1b";
    default:
      return key.length === 1 ? key : null;
  }
}

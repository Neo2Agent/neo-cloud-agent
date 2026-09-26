export type TerminalIntent = "setup" | "shell";

/** Interactive PTY only when the user opened the terminal themselves. */
export function shouldAutoOpenPty(intent: TerminalIntent): boolean {
  return intent === "shell";
}

export function workspaceNotReadyMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (!text || /not found|ENOENT|workspace|工作区|prepare|sandbox|还没/i.test(text)) {
    return "工作区还没准备好，不能开终端";
  }
  return text;
}

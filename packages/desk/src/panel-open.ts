export type DeskPanelTab = "home" | "files" | "terminal" | "artifacts" | "git";

/**
 * Web opens a chat as sidebar + transcript. The right inspector stays closed
 * until the reader asks for Git / 终端 / 文件. Restoring it on launch makes
 * Desk a three-column app before Web is.
 */
export function shouldRestoreDeskPanel(_input?: {
  storedOpen?: boolean;
  tab?: DeskPanelTab | string | null;
  folder?: string | null;
  runId?: string | null;
}): boolean {
  return false;
}

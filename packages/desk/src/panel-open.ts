export type DeskPanelTab = "home" | "files" | "terminal" | "artifacts" | "git";

/**
 * Chat stays the primary column. The right inspector (Git / 终端 / 文件)
 * is optional. Restoring an empty Files pane on launch steals the reading
 * width and wraps every bubble mid-word.
 */
export function shouldRestoreDeskPanel(input: {
  storedOpen: boolean;
  tab?: DeskPanelTab | string | null;
  folder?: string | null;
  runId?: string | null;
}): boolean {
  if (!input.storedOpen) return false;
  const tab = input.tab && input.tab !== "home" ? input.tab : "files";
  if (tab === "git" || tab === "artifacts" || tab === "terminal") return true;
  return Boolean(input.folder || input.runId);
}

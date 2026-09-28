export type InspectorTab = "git" | "terminal" | "files";
export type FilesView = "tree" | "artifacts";

export const INSPECTOR_TABS: ReadonlyArray<{ id: InspectorTab; label: string }> = [
  { id: "git", label: "Git" },
  { id: "terminal", label: "终端" },
  { id: "files", label: "文件" },
];

/** A plain chat has no repo, so it has no Git tab. */
export function inspectorTabs(hasGit: boolean): ReadonlyArray<{ id: InspectorTab; label: string }> {
  return hasGit ? INSPECTOR_TABS : INSPECTOR_TABS.filter((item) => item.id !== "git");
}

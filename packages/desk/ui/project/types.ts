export type WorkbenchTab = "overview" | "chats" | "board" | "assets" | "activity" | "settings";

export const WORKBENCH_TABS: Array<{ id: Exclude<WorkbenchTab, "overview" | "settings">; label: string }> = [
  { id: "activity", label: "动态" },
  { id: "board", label: "任务" },
  { id: "chats", label: "对话" },
  { id: "assets", label: "资产" },
];

export function resolveWorkbenchTab(tab?: WorkbenchTab): WorkbenchTab {
  if (tab === "overview") return "board";
  return tab ?? "board";
}

export type WorkbenchTab = "overview" | "chats" | "board" | "assets" | "activity" | "settings";

export const WORKBENCH_TABS: Array<{ id: WorkbenchTab; label: string; soon?: boolean }> = [
  { id: "overview", label: "概览" },
  { id: "chats", label: "对话" },
  { id: "board", label: "看板" },
  { id: "assets", label: "资产", soon: true },
  { id: "activity", label: "动态" },
  { id: "settings", label: "设置" },
];

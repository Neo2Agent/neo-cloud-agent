import type { AdminPage } from "./types";

const PAGES: AdminPage[] = ["overview", "users", "runs", "system"];

export const PAGE_META: Record<AdminPage, { title: string; label: string; hint: string }> = {
  overview: { title: "总览", label: "总览", hint: "用量、容量和平台状态" },
  users: { title: "用户", label: "用户", hint: "按占用排序，密码不会出现在这里" },
  runs: { title: "对话", label: "对话", hint: "最近 50 条，全平台可见" },
  system: { title: "系统", label: "系统", hint: "限流、模型和运行时" },
};

export function parsePage(hash: string): AdminPage {
  const raw = hash.replace(/^#\/?/, "").split("?")[0]?.split("/")[0] ?? "";
  return PAGES.includes(raw as AdminPage) ? (raw as AdminPage) : "overview";
}

export function readPage(): AdminPage {
  return parsePage(typeof location === "undefined" ? "" : location.hash);
}

export function pageHref(page: AdminPage): string {
  return `#/${page}`;
}

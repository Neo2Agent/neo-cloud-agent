import type { AdminPage } from "./types";

const PAGES: AdminPage[] = ["overview", "users", "runs", "experts", "system"];

export const PAGE_META: Record<AdminPage, { title: string; label: string; hint: string }> = {
  overview: { title: "用量和容量", label: "总览", hint: "看谁在用、槽忙不忙、本月 token 到哪了" },
  users: { title: "谁在占用平台", label: "用户", hint: "按占用排序，密码不会出现在这里" },
  runs: { title: "全平台最近对话", label: "对话", hint: "最近 50 条，全平台可见" },
  experts: { title: "配置并下发内置专家", label: "专家", hint: "先改配置，再下发给全部或指定用户" },
  system: { title: "运行时和限流", label: "系统", hint: "渠道和密钥不在这里改" },
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

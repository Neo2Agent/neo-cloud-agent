import type { AdminPage } from "./types";

const PAGES: AdminPage[] = ["overview", "users", "runs", "experts", "system"];

export type AdminRoute = {
  page: AdminPage;
  id: string;
  tab: string;
};

export const PAGE_META: Record<AdminPage, { title: string; label: string; hint: string }> = {
  overview: { title: "用量和容量", label: "总览", hint: "看谁在用、槽忙不忙、本月 token 到哪了" },
  users: { title: "谁在占用平台", label: "用户", hint: "按占用排序，密码不会出现在这里" },
  runs: { title: "全平台对话", label: "对话", hint: "点进一条就能看元数据和 transcript" },
  experts: { title: "配置并下发内置专家", label: "专家", hint: "先改配置，再下发给全部或指定用户" },
  system: { title: "运行时和限流", label: "系统", hint: "渠道和密钥不在这里改" },
};

function asPage(value: string): AdminPage {
  return PAGES.includes(value as AdminPage) ? (value as AdminPage) : "overview";
}

export function parseRoute(hash: string): AdminRoute {
  const raw = hash.replace(/^#\/?/, "");
  const [path = "", query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  const page = asPage(parts[0] ?? "");
  const id = page === "overview" || page === "system" ? "" : (parts[1] ?? "");
  const tab = new URLSearchParams(query).get("tab")?.trim() ?? "";
  return { page, id, tab };
}

export function readRoute(): AdminRoute {
  return parseRoute(typeof location === "undefined" ? "" : location.hash);
}

export function routeHref(page: AdminPage, opts?: { id?: string; tab?: string }): string {
  const id = opts?.id?.trim();
  const tab = opts?.tab?.trim();
  const path = id ? `#/${page}/${encodeURIComponent(id)}` : `#/${page}`;
  return tab ? `${path}?tab=${encodeURIComponent(tab)}` : path;
}

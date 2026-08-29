import type { RunSource } from "@neo-cloud-agent/contracts/run";

export function detectMobileSource(userAgent = ""): Extract<RunSource, "ios" | "android"> {
  return /iPhone|iPad|iPod/i.test(userAgent) ? "ios" : "android";
}

export function runDeepLink(runId: string, apiUrl = ""): string {
  const web = apiUrl ? `${apiUrl.replace(/\/$/, "")}/#/runs/${runId}` : `#/runs/${runId}`;
  return web;
}

export type MobileScreen = "home" | "chat" | "settings" | "experts" | "skills" | "projects";

export function parseMobileScreen(href: string): { screen: MobileScreen; runId: string | null } {
  const hash = href.includes("#") ? href.slice(href.indexOf("#")) : href;
  if (hash === "#/settings") return { screen: "settings", runId: null };
  if (hash === "#/experts") return { screen: "experts", runId: null };
  if (hash === "#/skills") return { screen: "skills", runId: null };
  if (hash === "#/projects") return { screen: "projects", runId: null };
  const runId = parseRunIdFromHref(href);
  if (runId) return { screen: "chat", runId };
  return { screen: "home", runId: null };
}

export function parseRunIdFromHref(href: string): string | null {
  const hash = /#\/runs\/([^/?#]+)/.exec(href)?.[1];
  if (hash) return hash;
  const custom = /(?:neo|exp):\/\/runs\/([^/?#]+)/.exec(href)?.[1];
  return custom ?? null;
}

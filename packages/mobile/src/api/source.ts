import type { RunSource } from "@neo-cloud-agent/contracts/run";

export function detectMobileSource(userAgent = ""): Extract<RunSource, "ios" | "android"> {
  return /iPhone|iPad|iPod/i.test(userAgent) ? "ios" : "android";
}

export function runDeepLink(runId: string, apiUrl = ""): string {
  if (apiUrl) {
    return `${apiUrl.replace(/\/$/, "")}/#/runs/${runId}`;
  }
  return `neo://runs/${runId}`;
}

export type MobileScreen = "home" | "chat" | "settings" | "experts" | "projects" | "automations" | "invite";

export function parseMobileScreen(href: string): { screen: MobileScreen; runId: string | null; inviteToken: string | null } {
  const hash = href.includes("#") ? href.slice(href.indexOf("#")) : href;
  if (hash === "#/settings") return { screen: "settings", runId: null, inviteToken: null };
  if (hash === "#/experts") return { screen: "experts", runId: null, inviteToken: null };
  if (hash === "#/projects") return { screen: "projects", runId: null, inviteToken: null };
  if (hash === "#/automations") return { screen: "automations", runId: null, inviteToken: null };
  const inviteToken = parseInviteTokenFromHref(href);
  if (inviteToken) return { screen: "invite", runId: null, inviteToken };
  const runId = parseRunIdFromHref(href);
  if (runId) return { screen: "chat", runId, inviteToken: null };
  return { screen: "home", runId: null, inviteToken: null };
}

export function parseInviteTokenFromHref(href: string): string | null {
  const hash = /#\/invite\/([^/?#]+)/.exec(href)?.[1];
  if (hash) return hash;
  return /(?:neo|exp):\/\/invite\/([^/?#]+)/.exec(href)?.[1] ?? null;
}

export function parseRunIdFromHref(href: string): string | null {
  const hash = /#\/runs\/([^/?#]+)/.exec(href)?.[1];
  if (hash) return hash;
  const custom = /(?:neo|exp):\/\/runs\/([^/?#]+)/.exec(href)?.[1];
  return custom ?? null;
}

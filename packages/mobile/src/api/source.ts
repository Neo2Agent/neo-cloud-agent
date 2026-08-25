import type { RunSource } from "@neo-cloud-agent/contracts";

export function detectMobileSource(userAgent = ""): Extract<RunSource, "ios" | "android"> {
  return /iPhone|iPad|iPod/i.test(userAgent) ? "ios" : "android";
}

export function runDeepLink(runId: string, apiUrl = ""): string {
  const web = apiUrl ? `${apiUrl.replace(/\/$/, "")}/#/runs/${runId}` : `#/runs/${runId}`;
  return web;
}

export function parseRunIdFromHref(href: string): string | null {
  const hash = /#\/runs\/([^/?#]+)/.exec(href)?.[1];
  if (hash) return hash;
  const custom = /(?:neo|exp):\/\/runs\/([^/?#]+)/.exec(href)?.[1];
  return custom ?? null;
}

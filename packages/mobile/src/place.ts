import { isRemoteControlTarget, type ExecutionTarget } from "@neo-cloud-agent/contracts/run";

export const CLOUD_TARGET = { loop: "cloud", tools: "cloud" } as const satisfies ExecutionTarget;

export type RunPlace = "cloud" | "remote";

export function runPlace(run?: { executionTarget?: ExecutionTarget | null } | null): RunPlace {
  return isRemoteControlTarget(run?.executionTarget) ? "remote" : "cloud";
}

export function runPlaceLabel(run?: { executionTarget?: ExecutionTarget | null } | null): string {
  return runPlace(run) === "remote" ? "remote" : "cloud";
}

export const DEFAULT_API_URL = "https://neorun.cloud";

const LEGACY_PRODUCTION_API_URLS = new Set([
  "http://62.234.211.200",
  "http://neorun.cloud",
  "http://www.neorun.cloud",
  "https://www.neorun.cloud",
]);

/** Map 备案期明文入口到 HTTPS 域名。局域网调试地址原样保留。 */
export function canonicalApiUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "");
  if (!trimmed || LEGACY_PRODUCTION_API_URLS.has(trimmed)) return DEFAULT_API_URL;
  return trimmed;
}

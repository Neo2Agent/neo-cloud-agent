import type { EgressMode, EgressPolicy } from "./environment.js";

/** Package registries and public SCM hosts included in `default_plus_allowlist`. */
export const DEFAULT_EGRESS_DOMAINS = [
  "api.deepseek.com",
  "api.openai.com",
  "api.anthropic.com",
  "github.com",
  "api.github.com",
  "gitlab.com",
  "bitbucket.org",
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "files.pythonhosted.org",
  "proxy.golang.org",
  "sum.golang.org",
  "crates.io",
  "static.crates.io",
] as const;

/** Always reachable so the worker can talk to the control plane / Gateway / SCM. */
export const ALWAYS_EGRESS_DOMAINS = [
  "localhost",
  "127.0.0.1",
  "host.docker.internal",
  "github.com",
  "api.github.com",
] as const;

export type EgressDecision = {
  allow: boolean;
  host: string | null;
  mode: EgressMode;
  reason: string;
};

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((item) => item?.trim().toLowerCase()).filter((item): item is string => Boolean(item)))];
}

export function hostnameFromTarget(target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("git@")) {
    const host = trimmed.slice("git@".length).split(":")[0]?.trim();
    return host || null;
  }
  if (trimmed.startsWith("ssh://") || /^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).hostname || null;
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("file://") || trimmed.startsWith("/") || trimmed.startsWith(".")) {
    return null;
  }
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:].*)?$/i.test(trimmed)) {
    return trimmed.split(/[/:]/)[0] ?? null;
  }
  return null;
}

export function hostMatches(hostname: string, pattern: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  const rule = pattern.trim().toLowerCase().replace(/^\*\./, "").replace(/^\./, "").replace(/\.$/, "");
  if (!host || !rule) {
    return false;
  }
  return host === rule || host.endsWith(`.${rule}`);
}

export function mergeEgressPolicy(policy: EgressPolicy | undefined | null, alwaysAllow: string[] = []): EgressPolicy {
  const mode: EgressMode = policy?.mode ?? "allow_all";
  const user = policy?.domains ?? [];
  if (mode === "allow_all") {
    return { mode, domains: unique([...user, ...alwaysAllow]) };
  }
  if (mode === "default_plus_allowlist") {
    return { mode, domains: unique([...DEFAULT_EGRESS_DOMAINS, ...user, ...ALWAYS_EGRESS_DOMAINS, ...alwaysAllow]) };
  }
  return { mode: "allowlist_only", domains: unique([...user, ...ALWAYS_EGRESS_DOMAINS, ...alwaysAllow]) };
}

export function evaluateEgress(policy: EgressPolicy | undefined | null, target: string): EgressDecision {
  const merged = mergeEgressPolicy(policy);
  const host = hostnameFromTarget(target);
  if (merged.mode === "allow_all") {
    return { allow: true, host, mode: merged.mode, reason: "allow_all" };
  }
  if (!host) {
    return { allow: true, host: null, mode: merged.mode, reason: "local" };
  }
  if ((merged.domains ?? []).some((item) => hostMatches(host, item))) {
    return { allow: true, host, mode: merged.mode, reason: "allowlist" };
  }
  return {
    allow: false,
    host,
    mode: merged.mode,
    reason: `${merged.mode} blocked ${host}`,
  };
}

import type { Environment, EnvironmentJson, TerminalSpec } from "@neo-cloud-agent/contracts";

const environments = new Map<string, Environment>();

export function upsertEnvironment(env: Environment): Environment {
  environments.set(env.id, env);
  return env;
}

export function getEnvironment(id: string): Environment | undefined {
  return environments.get(id);
}

export function listEnvironments(): Environment[] {
  return [...environments.values()];
}

export function parseEnvironmentJson(raw: unknown): EnvironmentJson {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const input = raw as Record<string, unknown>;
  const config: EnvironmentJson = {};
  if (typeof input.snapshot === "string") config.snapshot = input.snapshot;
  if (typeof input.install === "string") config.install = input.install;
  if (typeof input.start === "string") config.start = input.start;
  if (Array.isArray(input.repos) && input.repos.every((item) => typeof item === "string")) {
    config.repos = input.repos;
  }
  if (Array.isArray(input.terminals)) {
    const terminals: TerminalSpec[] = [];
    for (const item of input.terminals) {
      if (!item || typeof item !== "object") continue;
      const terminal = item as Record<string, unknown>;
      if (typeof terminal.name === "string" && typeof terminal.command === "string") {
        terminals.push({ name: terminal.name, command: terminal.command });
      }
    }
    if (terminals.length > 0) {
      config.terminals = terminals;
    }
  }
  if (input.egress && typeof input.egress === "object" && !Array.isArray(input.egress)) {
    const egress = input.egress as Record<string, unknown>;
    if (
      egress.mode === "allow_all" ||
      egress.mode === "default_plus_allowlist" ||
      egress.mode === "allowlist_only"
    ) {
      config.egress = {
        mode: egress.mode,
        domains: Array.isArray(egress.domains)
          ? egress.domains.filter((item): item is string => typeof item === "string")
          : undefined,
      };
    }
  }
  return config;
}

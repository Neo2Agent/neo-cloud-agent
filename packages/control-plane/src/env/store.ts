import type { Environment, EnvironmentJson } from "@neo-cloud-agent/contracts";

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
  if (!raw || typeof raw !== "object") {
    return {};
  }
  return raw as EnvironmentJson;
}

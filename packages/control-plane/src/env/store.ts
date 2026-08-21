import type { Environment } from "@neo-cloud-agent/contracts";
export { parseEnvironmentJson } from "@neo-cloud-agent/contracts";

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

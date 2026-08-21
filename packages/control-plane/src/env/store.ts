import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CreateEnvironmentRequest, Environment } from "@neo-cloud-agent/contracts";
import { parseEnvironmentJson } from "@neo-cloud-agent/contracts";
import { controlStateDir } from "../store/persist.js";

export { parseEnvironmentJson } from "@neo-cloud-agent/contracts";

const environments = new Map<string, Environment>();
let loaded = false;

function envFile(runsDir?: string): string {
  return path.join(controlStateDir(runsDir), "environments.json");
}

function persist(): void {
  const file = envFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify([...environments.values()], null, 2)}\n`);
  renameSync(tmp, file);
}

function ensureLoaded(): void {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    const parsed = JSON.parse(readFileSync(envFile(), "utf8")) as Environment[];
    for (const env of parsed) {
      if (env?.id) {
        environments.set(env.id, env);
      }
    }
  } catch {
    // first boot
  }
}

export function upsertEnvironment(env: Environment): Environment {
  ensureLoaded();
  environments.set(env.id, env);
  persist();
  return env;
}

export function createEnvironment(input: CreateEnvironmentRequest, orgId: string): Environment {
  const createdAt = new Date().toISOString();
  const config = parseEnvironmentJson(input.config ?? {});
  if (input.repoUrls?.length) {
    config.repos = input.repoUrls;
  }
  return upsertEnvironment({
    id: `env_${crypto.randomUUID()}`,
    orgId,
    name: input.name?.trim() || input.repoUrls?.[0] || "environment",
    environmentJsonPath: null,
    config,
    secrets: [],
    createdAt,
    updatedAt: createdAt,
  });
}

export function getEnvironment(id: string): Environment | undefined {
  ensureLoaded();
  return environments.get(id);
}

export function listEnvironments(): Environment[] {
  ensureLoaded();
  return [...environments.values()];
}

export function resetEnvironmentsForTests(): void {
  environments.clear();
  loaded = false;
}

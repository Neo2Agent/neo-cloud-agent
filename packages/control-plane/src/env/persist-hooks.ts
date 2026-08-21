import type { Build, Environment } from "@neo-cloud-agent/contracts";

export type EnvPersistHooks = {
  onEnvironment?: (env: Environment) => void;
  onBuild?: (build: Build) => void;
};

let hooks: EnvPersistHooks = {};

export function setEnvPersistHooks(next: EnvPersistHooks): void {
  hooks = next;
}

export function envPersistHooks(): EnvPersistHooks {
  return hooks;
}

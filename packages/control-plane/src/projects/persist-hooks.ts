import type { Project } from "@neo-cloud-agent/contracts";

type ProjectPersistHooks = {
  onWrite?: (items: Project[]) => void;
};

let hooks: ProjectPersistHooks = {};

export function setProjectPersistHooks(next: ProjectPersistHooks): void {
  hooks = next;
}

export function projectPersistHooks(): ProjectPersistHooks {
  return hooks;
}

import type { Desk } from "@neo-cloud-agent/contracts";

type DeskPersistHooks = {
  onWrite?: (items: Desk[]) => void;
};

let hooks: DeskPersistHooks = {};

export function setDeskPersistHooks(next: DeskPersistHooks): void {
  hooks = next;
}

export function deskPersistHooks(): DeskPersistHooks {
  return hooks;
}

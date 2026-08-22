import type { Automation } from "@neo-cloud-agent/contracts";

type AutomationPersistHooks = {
  onWrite?: (items: Automation[]) => void;
};

let hooks: AutomationPersistHooks = {};

export function setAutomationPersistHooks(next: AutomationPersistHooks): void {
  hooks = next;
}

export function automationPersistHooks(): AutomationPersistHooks {
  return hooks;
}

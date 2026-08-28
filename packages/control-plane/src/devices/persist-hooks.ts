import type { Device } from "@neo-cloud-agent/contracts";

type DevicePersistHooks = {
  onWrite?: (items: Device[]) => void;
};

let hooks: DevicePersistHooks = {};

export function setDevicePersistHooks(next: DevicePersistHooks): void {
  hooks = next;
}

export function devicePersistHooks(): DevicePersistHooks {
  return hooks;
}

import type { DeskTarget } from "./desk";

const LAST_RUN_KEY = "neo.lastRunId";
const LAST_TARGET_KEY = "neo.lastTarget";

export function readLastRunId(storage: Pick<Storage, "getItem"> = localStorage): string | null {
  try {
    const value = storage.getItem(LAST_RUN_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function writeLastRunId(id: string | null, storage: Pick<Storage, "setItem" | "removeItem"> = localStorage): void {
  if (!id) {
    storage.removeItem(LAST_RUN_KEY);
    return;
  }
  storage.setItem(LAST_RUN_KEY, id);
}

export function readLastTarget(storage: Pick<Storage, "getItem"> = localStorage): DeskTarget | null {
  try {
    const parsed = JSON.parse(storage.getItem(LAST_TARGET_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const kind = (parsed as DeskTarget).kind;
    if (kind !== "cloud" && kind !== "desk" && kind !== "remote") {
      return null;
    }
    return parsed as DeskTarget;
  } catch {
    return null;
  }
}

export function writeLastTarget(target: DeskTarget, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(LAST_TARGET_KEY, JSON.stringify(target));
}

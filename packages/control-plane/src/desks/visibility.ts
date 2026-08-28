import type { IncomingMessage } from "node:http";
import { DESK_HOST_OFFLINE_MESSAGE, DESK_HOST_UNBOUND_MESSAGE } from "@neo-cloud-agent/contracts/desk";
import { actorCanAccessRun, type Actor, type RunAccessShape } from "../security/actor.js";

export { DESK_HOST_OFFLINE_MESSAGE, DESK_HOST_UNBOUND_MESSAGE };

export const DESK_CLIENT_HEADER = "x-neo-client";
export const DESK_CLIENT_QUERY = "client";
export const DESK_CLIENT_VALUE = "desk";

export type DeskVisibilityRun = RunAccessShape & {
  executionTarget?: { loop?: string; deskId?: string | null; remoteControl?: boolean } | null;
};

/** EventSource cannot set headers, so Desk also passes `?client=desk`. */
export function requestIsDeskClient(req: IncomingMessage): boolean {
  const header = String(req.headers[DESK_CLIENT_HEADER] ?? "")
    .trim()
    .toLowerCase();
  if (header === DESK_CLIENT_VALUE) {
    return true;
  }
  try {
    return (
      new URL(req.url ?? "/", "http://control-plane.local").searchParams.get(DESK_CLIENT_QUERY)?.toLowerCase() ===
      DESK_CLIENT_VALUE
    );
  } catch {
    return false;
  }
}

/** Like Cursor My Machines: no live worker means the request fails, not a cloud fallback. */
export function deskFollowUpBlockReason(
  run: DeskVisibilityRun,
  online: (deskId: string) => boolean,
): string | null {
  if (run.executionTarget?.loop !== "desk") {
    return null;
  }
  const deskId = run.executionTarget.deskId?.trim();
  if (!deskId) {
    return DESK_HOST_UNBOUND_MESSAGE;
  }
  return online(deskId) ? null : DESK_HOST_OFFLINE_MESSAGE;
}

/** Web / phone see a desk run only when that conversation opted into Remote Control. */
export function deskRunVisibleRemotely(run: DeskVisibilityRun): boolean {
  if (run.executionTarget?.loop !== "desk") {
    return true;
  }
  return run.executionTarget.remoteControl === true;
}

export function runVisibleToActor(run: DeskVisibilityRun, actor: Actor, deskClient: boolean): boolean {
  if (!actorCanAccessRun(actor, run)) {
    return false;
  }
  if (deskClient || actor.kind !== "user") {
    return true;
  }
  return deskRunVisibleRemotely(run);
}

import { DEFAULT_ADMIN_LOGIN } from "../accounts/accounts.js";
import { normalizeEmail } from "../accounts/types.js";
import { getConfig } from "../config.js";

export type Actor =
  | { kind: "anonymous"; userId: string; orgId: string }
  | { kind: "service"; userId: string; orgId: string }
  | { kind: "user"; userId: string; orgId: string; email: string; sessionId: string };

export type RunAccessShape = {
  userId: string;
  assigneeUserId?: string | null;
  source?: string;
  collaborators?: Array<{ userId: string }> | null;
};

export function defaultActor(kind: "anonymous" | "service" = "anonymous"): Actor {
  const config = getConfig();
  return { kind, userId: config.userId, orgId: config.orgId };
}

/** `admin` plus comma-separated `ADMIN_EMAILS`. */
export function adminEmailAllowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean);
}

export function isAdminLogin(email: string | null | undefined): boolean {
  const login = normalizeEmail(email ?? "");
  if (!login) {
    return false;
  }
  return login === DEFAULT_ADMIN_LOGIN || adminEmailAllowlist().includes(login);
}

export function actorIsPlatformAdmin(actor: Actor): boolean {
  if (actor.kind === "service") {
    return true;
  }
  if (actor.kind === "user") {
    return isAdminLogin(actor.email);
  }
  return false;
}

export function actorCanAccessRun(actor: Actor, run: RunAccessShape): boolean {
  if (actor.kind !== "user") {
    return true;
  }
  if (actor.userId === run.userId || (run.assigneeUserId && actor.userId === run.assigneeUserId)) {
    return true;
  }
  if (run.collaborators?.some((item) => item.userId === actor.userId)) {
    return true;
  }
  if (run.source === "automation" && run.userId === getConfig().userId) {
    return true;
  }
  return false;
}

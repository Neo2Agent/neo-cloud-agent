import { projectHasMember } from "../projects/store.js";
import { getConfig } from "../config.js";

export type Actor =
  | { kind: "anonymous"; userId: string; orgId: string }
  | { kind: "service"; userId: string; orgId: string }
  | { kind: "user"; userId: string; orgId: string; email: string; sessionId: string };

export function defaultActor(kind: "anonymous" | "service" = "anonymous"): Actor {
  const config = getConfig();
  return { kind, userId: config.userId, orgId: config.orgId };
}

export function actorCanAccessRun(
  actor: Actor,
  run: { userId: string; assigneeUserId?: string | null; projectId?: string | null },
): boolean {
  if (actor.kind !== "user") {
    return true;
  }
  if (actor.userId === run.userId || (run.assigneeUserId && actor.userId === run.assigneeUserId)) {
    return true;
  }
  return Boolean(run.projectId && projectHasMember(run.projectId, actor.userId));
}

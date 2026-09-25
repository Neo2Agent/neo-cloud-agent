import type { Run } from "@neo-cloud-agent/contracts";
import { RUN_LIST_CHANGED_KIND, type UserListEvent } from "@neo-cloud-agent/contracts/client-stream";

type Listener = (event: UserListEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const lastSignature = new Map<string, string>();

export function runListSignature(run: Pick<Run, "id" | "title" | "status" | "projectId" | "userId" | "assigneeUserId" | "deletedAt" | "collaborators">): string {
  const collabs = (run.collaborators ?? [])
    .map((item) => item.userId)
    .sort()
    .join(",");
  return [run.id, run.title, run.status, run.projectId ?? "", run.userId ?? "", run.assigneeUserId ?? "", run.deletedAt ?? "", collabs].join("|");
}

export function runListAudience(run: Pick<Run, "userId" | "assigneeUserId" | "collaborators">): string[] {
  const users = new Set<string>();
  if (run.userId) users.add(run.userId);
  if (run.assigneeUserId) users.add(run.assigneeUserId);
  for (const item of run.collaborators ?? []) {
    if (item.userId) users.add(item.userId);
  }
  return [...users];
}

export function notifyRunListWatchers(run: Run, reason = "persist"): void {
  const signature = runListSignature(run);
  if (lastSignature.get(run.id) === signature) return;
  lastSignature.set(run.id, signature);
  const event: UserListEvent = {
    id: `list-${run.id}-${Date.now()}`,
    kind: RUN_LIST_CHANGED_KIND,
    createdAt: new Date().toISOString(),
    data: { runId: run.id, reason },
  };
  for (const userId of runListAudience(run)) {
    for (const listener of listeners.get(userId) ?? []) {
      listener(event);
    }
  }
}

export function subscribeUserList(userId: string, listener: Listener): () => void {
  const bucket = listeners.get(userId) ?? new Set();
  bucket.add(listener);
  listeners.set(userId, bucket);
  return () => {
    bucket.delete(listener);
    if (bucket.size === 0) listeners.delete(userId);
  };
}

export function resetUserListWatchers(): void {
  listeners.clear();
  lastSignature.clear();
}

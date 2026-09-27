/**
 * Whether an inbox assignment is this machine continuing its own run, or a
 * remote client asking it to start work (Cursor My Machines / Web 本机).
 *
 * Phase-1 This Computer and Desk-started Remote Control follow-ups arrive
 * without `requestedBy` or a control-plane `workspaceId`. Web/Mobile new
 * chats on this machine always carry at least one of those.
 */
export function dispatchedAssignmentDecision(input: {
  allowRemote: boolean;
  requestedBy?: string | null;
  workspaceId?: string | null;
}): "own" | "accept" | "reject" {
  const dispatched = Boolean(input.requestedBy?.trim()) || Boolean(input.workspaceId?.trim());
  if (!dispatched) {
    return "own";
  }
  return input.allowRemote ? "accept" : "reject";
}

export const REMOTE_DISPATCH_OFF_REASON = "这台电脑没有开启远程派活";

/** Match a local folder by the Desk-only id or the catalog id the control plane issued. */
export function matchBoundWorkspace<T extends { id: string; remoteId?: string; folder: string }>(
  items: T[],
  selector: { workspaceId?: string | null; folder?: string | null },
  resolvePath: (folder: string) => string = (folder) => folder,
): T | undefined {
  if (selector.workspaceId) {
    return items.find((item) => item.id === selector.workspaceId || item.remoteId === selector.workspaceId);
  }
  if (selector.folder) {
    const folder = resolvePath(selector.folder);
    return items.find((item) => resolvePath(item.folder) === folder);
  }
  return undefined;
}

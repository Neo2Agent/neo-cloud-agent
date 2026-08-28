/**
 * What This Computer does when a file tool leaves the authorized folder.
 *
 * Only Desk reads this. The cloud worker never sees it: a cloud VM is already
 * the box. `ask` and `allowlist` are reserved names; they collapse to deny
 * until a later change implements them in Desk prefs only.
 */
export const DEFAULT_OUT_OF_WORKSPACE_POLICY = "deny" as const;

export const OUT_OF_WORKSPACE_POLICIES = ["deny", "ask", "allowlist"] as const;

export type OutOfWorkspacePolicy = (typeof OUT_OF_WORKSPACE_POLICIES)[number];

export function normalizeOutOfWorkspacePolicy(value: unknown): OutOfWorkspacePolicy {
  if (value === "deny") {
    return "deny";
  }
  return DEFAULT_OUT_OF_WORKSPACE_POLICY;
}

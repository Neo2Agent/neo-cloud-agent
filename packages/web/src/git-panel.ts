import type { RunGitContext } from "@neo-cloud-agent/contracts/git";

/** Cloud commits via the control plane. Desk commits on the laptop, like Cursor SCM. */
export function gitPanelCanCommit(input: {
  context: Exclude<RunGitContext, "none">;
  deskApp: boolean;
  dirty: boolean;
}): boolean {
  if (!input.dirty) {
    return false;
  }
  if (input.context === "cloud") {
    return true;
  }
  return input.deskApp;
}

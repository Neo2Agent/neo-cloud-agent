import { createDiagnosticsTool } from "./neo-diag.js";
import { createGitCommitTool } from "./neo-git.js";
import { createPullRequestTool } from "./neo-pr.js";
import type { CloudToolContext, CloudToolDefinition } from "./types.js";

export const CLOUD_TOOL_NAMES = ["neo_git_commit", "neo_pr_open", "neo_diag"] as const;

export function createCloudTools(ctx: CloudToolContext): CloudToolDefinition[] {
  return [createGitCommitTool(ctx), createPullRequestTool(ctx), createDiagnosticsTool(ctx)];
}

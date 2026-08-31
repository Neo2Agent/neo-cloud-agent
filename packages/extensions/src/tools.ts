import { createArtifactTool } from "./neo-artifact.js";
import { createBrowserTool } from "./neo-browser.js";
import { createDiagnosticsTool } from "./neo-diag.js";
import { createGitCommitTool } from "./neo-git.js";
import { createMcpCallTool, createMcpListTool } from "./neo-mcp.js";
import { createMemoryAddTool, createMemorySearchTool } from "./neo-memory.js";
import { createPullRequestTool } from "./neo-pr.js";
import { createSubagentTool } from "./neo-subagent.js";
import { createSubscribeTool } from "./neo-subscribe.js";
import type { CloudToolContext, CloudToolDefinition } from "./types.js";

export const CLOUD_TOOL_NAMES = [
  "neo_git_commit",
  "neo_pr_open",
  "neo_diag",
  "neo_artifact_upload",
  "neo_browse",
  "neo_mcp_list",
  "neo_mcp_call",
  "neo_subagent",
  "neo_subscribe",
  "neo_memory_search",
  "neo_memory_add",
] as const;

export function createCloudTools(ctx: CloudToolContext): CloudToolDefinition[] {
  return [
    createGitCommitTool(ctx),
    createPullRequestTool(ctx),
    createDiagnosticsTool(ctx),
    createArtifactTool(ctx),
    createBrowserTool(ctx),
    createMcpListTool(ctx),
    createMcpCallTool(ctx),
    createSubagentTool(ctx),
    createSubscribeTool(ctx),
    createMemorySearchTool(ctx),
    createMemoryAddTool(ctx),
  ];
}

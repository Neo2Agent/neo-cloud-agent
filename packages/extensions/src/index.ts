import { neoArtifact } from "./neo-artifact.js";
import { neoBrowser } from "./neo-browser.js";
import { neoDiag } from "./neo-diag.js";
import { neoGit } from "./neo-git.js";
import { neoMcp } from "./neo-mcp.js";
import { neoPr } from "./neo-pr.js";
import { neoSubagent } from "./neo-subagent.js";
import type { CloudExtension } from "./types.js";

export type {
  CloudExtension,
  CloudToolContext,
  CloudToolDefinition,
  CloudToolFetch,
  CloudToolParameterSchema,
  CloudToolResult,
} from "./types.js";
export { defineExtension } from "./types.js";
export { createCloudTools, CLOUD_TOOL_NAMES } from "./tools.js";
export { createGitCommitTool, executeGitCommit } from "./neo-git.js";
export { createPullRequestTool, executeOpenPullRequest } from "./neo-pr.js";
export { createDiagnosticsTool, executeDiagnostics } from "./neo-diag.js";
export { createArtifactTool, executeArtifactUpload } from "./neo-artifact.js";
export { createBrowserTool, executeBrowse } from "./neo-browser.js";
export { createMcpCallTool, createMcpListTool, executeMcpCall, executeMcpList, listWorkspaceMcpServers } from "./neo-mcp.js";
export { createSubagentTool, executeSubagentTool, availableSubagents, loadProjectSubagents } from "./neo-subagent.js";
export { extractPageText } from "./html-text.js";
export { neoArtifact, neoBrowser, neoDiag, neoGit, neoMcp, neoPr, neoSubagent };

export function loadCloudExtensions(): CloudExtension[] {
  return [neoGit, neoPr, neoMcp, neoDiag, neoArtifact, neoBrowser, neoSubagent];
}

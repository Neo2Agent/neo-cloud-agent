import { defineTool } from "@earendil-works/pi-coding-agent";
import { CLOUD_TOOL_NAMES, createCloudTools, type CloudToolContext, type CloudToolResult } from "@neo-cloud-agent/extensions";
import { Type } from "typebox";

export { CLOUD_TOOL_NAMES };

export const FILE_TOOL_NAMES = ["read", "write", "edit", "bash", "grep", "find", "ls"] as const;

export const CLOUD_SYSTEM_PROMPT = `You are Neo Cloud Agent running in an isolated workspace.
Repositories the user attached are already in the current working directory (one repo at the root, or each repo in its own folder).
Use the local tools (read, write, edit, bash, grep, find, ls) to complete the user's task.
If you change the project, run its tests (for example \`sh test.sh\` or the documented test command).
Do not ask for API keys. LLM calls already go through the cloud gateway.
Do not \`git commit\`, \`git push\`, or open pull requests with bash, gh, or curl. Use neo_git_commit and neo_pr_open; the control plane holds SCM credentials.
Use neo_diag to inspect setup logs, egress denials, and the environment / build version.
Use neo_artifact_upload to attach workspace files (logs, screenshots, reports) so the user can open them in chat. Do not paste large binaries into the reply.
Use neo_browse to fetch a public http(s) page as title plus text. Egress still applies. This is not a headed browser.
When .neo/environment.json defines mcp servers, use neo_mcp_list then neo_mcp_call. Do not start MCP servers yourself.
Be concise and verify your work.`;

export function sessionToolNames(): string[] {
  return [...FILE_TOOL_NAMES, ...CLOUD_TOOL_NAMES];
}

function toPiResult(result: CloudToolResult) {
  return {
    content: [{ type: "text" as const, text: result.content }],
    details: result.details ?? {},
    isError: result.isError === true,
  };
}

export function createPiCloudTools(ctx: CloudToolContext) {
  const byName = new Map(createCloudTools(ctx).map((tool) => [tool.name, tool]));
  for (const name of CLOUD_TOOL_NAMES) {
    if (!byName.has(name)) {
      throw new Error(`cloud tools failed to load: ${name}`);
    }
  }

  const commit = byName.get("neo_git_commit")!;
  const pullRequest = byName.get("neo_pr_open")!;
  const diagnostics = byName.get("neo_diag")!;
  const artifact = byName.get("neo_artifact_upload")!;
  const browse = byName.get("neo_browse")!;
  const mcpList = byName.get("neo_mcp_list")!;
  const mcpCall = byName.get("neo_mcp_call")!;

  return [
    defineTool({
      name: commit.name,
      label: commit.label,
      description: commit.description,
      parameters: Type.Object({
        message: Type.String({ description: "Commit message" }),
        paths: Type.Optional(Type.Array(Type.String({ description: "Path to stage" }))),
      }),
      execute: async (_id, params) => toPiResult(await commit.execute(params)),
    }),
    defineTool({
      name: pullRequest.name,
      label: pullRequest.label,
      description: pullRequest.description,
      parameters: Type.Object({
        title: Type.String({ description: "Pull request title" }),
        body: Type.Optional(Type.String({ description: "Optional pull request body" })),
      }),
      execute: async (_id, params) => toPiResult(await pullRequest.execute(params)),
    }),
    defineTool({
      name: diagnostics.name,
      label: diagnostics.label,
      description: diagnostics.description,
      parameters: Type.Object({
        section: Type.Optional(
          Type.Union([
            Type.Literal("all"),
            Type.Literal("setup"),
            Type.Literal("egress"),
            Type.Literal("environment"),
          ]),
        ),
      }),
      execute: async (_id, params) => toPiResult(await diagnostics.execute(params)),
    }),
    defineTool({
      name: artifact.name,
      label: artifact.label,
      description: artifact.description,
      parameters: Type.Object({
        path: Type.String({ description: "Workspace-relative file path" }),
        name: Type.Optional(Type.String({ description: "Optional download name" })),
        contentType: Type.Optional(Type.String({ description: "Optional MIME type" })),
      }),
      execute: async (_id, params) => toPiResult(await artifact.execute(params)),
    }),
    defineTool({
      name: browse.name,
      label: browse.label,
      description: browse.description,
      parameters: Type.Object({
        url: Type.String({ description: "http or https URL" }),
      }),
      execute: async (_id, params) => toPiResult(await browse.execute(params)),
    }),
    defineTool({
      name: mcpList.name,
      label: mcpList.label,
      description: mcpList.description,
      parameters: Type.Object({}),
      execute: async (_id, params) => toPiResult(await mcpList.execute((params ?? {}) as Record<string, unknown>)),
    }),
    defineTool({
      name: mcpCall.name,
      label: mcpCall.label,
      description: mcpCall.description,
      parameters: Type.Object({
        server: Type.String({ description: "MCP server name" }),
        tool: Type.String({ description: "Tool name" }),
        arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      }),
      execute: async (_id, params) => toPiResult(await mcpCall.execute(params)),
    }),
  ];
}

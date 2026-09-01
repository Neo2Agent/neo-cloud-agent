import { defineTool } from "@earendil-works/pi-coding-agent";
import { CLOUD_SYSTEM_PROMPT } from "@neo-cloud-agent/contracts";
import { CLOUD_TOOL_NAMES, createCloudTools, type CloudToolContext, type CloudToolResult } from "@neo-cloud-agent/extensions";
import { Type } from "typebox";

export { CLOUD_SYSTEM_PROMPT, CLOUD_TOOL_NAMES };

export const FILE_TOOL_NAMES = ["read", "write", "edit", "bash", "grep", "find", "ls"] as const;

export function sessionToolNames(options?: { includeSubagent?: boolean }): string[] {
  const cloud =
    options?.includeSubagent === false
      ? CLOUD_TOOL_NAMES.filter((name) => name !== "neo_subagent" && name !== "neo_subscribe")
      : [...CLOUD_TOOL_NAMES];
  return [...FILE_TOOL_NAMES, ...cloud];
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
  const subagent = byName.get("neo_subagent")!;
  const subscribe = byName.get("neo_subscribe")!;
  const memorySearch = byName.get("neo_memory_search")!;
  const memoryAdd = byName.get("neo_memory_add")!;
  const memoryUpdate = byName.get("neo_memory_update")!;
  const memoryDelete = byName.get("neo_memory_delete")!;

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
    defineTool({
      name: subagent.name,
      label: subagent.label,
      description: subagent.description,
      parameters: Type.Object({
        agent: Type.Optional(Type.String({ description: "Single-mode agent name" })),
        task: Type.Optional(Type.String({ description: "Single-mode task text" })),
        tasks: Type.Optional(
          Type.Array(
            Type.Object({
              agent: Type.String(),
              task: Type.String(),
            }),
          ),
        ),
        chain: Type.Optional(
          Type.Array(
            Type.Object({
              agent: Type.String(),
              task: Type.String(),
            }),
          ),
        ),
      }),
      execute: async (_id, params) => toPiResult(await subagent.execute((params ?? {}) as Record<string, unknown>)),
    }),
    defineTool({
      name: subscribe.name,
      label: subscribe.label,
      description: subscribe.description,
      parameters: Type.Object({
        events: Type.Optional(
          Type.Array(
            Type.Union([Type.Literal("pr_activity"), Type.Literal("ci")]),
            { description: "pr_activity and/or ci. Default both." },
          ),
        ),
      }),
      execute: async (_id, params) => toPiResult(await subscribe.execute((params ?? {}) as Record<string, unknown>)),
    }),
    defineTool({
      name: memorySearch.name,
      label: memorySearch.label,
      description: memorySearch.description,
      parameters: Type.Object({
        query: Type.String({ description: "What to look up" }),
        limit: Type.Optional(Type.Number({ description: "Max hits. Default 8." })),
      }),
      execute: async (_id, params) => toPiResult(await memorySearch.execute((params ?? {}) as Record<string, unknown>)),
    }),
    defineTool({
      name: memoryAdd.name,
      label: memoryAdd.label,
      description: memoryAdd.description,
      parameters: Type.Object({
        text: Type.String({ description: "One short fact to store" }),
      }),
      execute: async (_id, params) => toPiResult(await memoryAdd.execute((params ?? {}) as Record<string, unknown>)),
    }),
    defineTool({
      name: memoryUpdate.name,
      label: memoryUpdate.label,
      description: memoryUpdate.description,
      parameters: Type.Object({
        id: Type.String({ description: "Memory id from search" }),
        text: Type.String({ description: "Corrected fact" }),
      }),
      execute: async (_id, params) => toPiResult(await memoryUpdate.execute((params ?? {}) as Record<string, unknown>)),
    }),
    defineTool({
      name: memoryDelete.name,
      label: memoryDelete.label,
      description: memoryDelete.description,
      parameters: Type.Object({
        id: Type.String({ description: "Memory id from search" }),
      }),
      execute: async (_id, params) => toPiResult(await memoryDelete.execute((params ?? {}) as Record<string, unknown>)),
    }),
  ];
}

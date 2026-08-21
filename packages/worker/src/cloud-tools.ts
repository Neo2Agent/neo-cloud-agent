import { defineTool } from "@earendil-works/pi-coding-agent";
import { createCloudTools, type CloudToolContext, type CloudToolResult } from "@neo-cloud-agent/extensions";
import { Type } from "typebox";

export const FILE_TOOL_NAMES = ["read", "write", "edit", "bash", "grep", "find", "ls"] as const;
export const CLOUD_TOOL_NAMES = ["neo_git_commit", "neo_pr_open", "neo_diag"] as const;

export const CLOUD_SYSTEM_PROMPT = `You are Neo Cloud Agent running in an isolated workspace.
Repositories the user attached are already in the current working directory (one repo at the root, or each repo in its own folder).
Use the local tools (read, write, edit, bash, grep, find, ls) to complete the user's task.
If you change the project, run its tests (for example \`sh test.sh\` or the documented test command).
Do not ask for API keys. LLM calls already go through the cloud gateway.
Do not \`git commit\`, \`git push\`, or open pull requests with bash, gh, or curl. Use neo_git_commit and neo_pr_open; the control plane holds SCM credentials.
Use neo_diag to inspect setup logs, egress denials, and the environment / build version.
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
  const commit = byName.get("neo_git_commit");
  const pullRequest = byName.get("neo_pr_open");
  const diagnostics = byName.get("neo_diag");
  if (!commit || !pullRequest || !diagnostics) {
    throw new Error("cloud tools failed to load");
  }

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
  ];
}

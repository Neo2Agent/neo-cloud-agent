import { asString, asStringList, callControlPlane } from "./client.js";
import type { CloudToolContext, CloudToolDefinition, CloudToolResult } from "./types.js";

export type CommitToolResponse = {
  sha?: string;
  branch?: string;
  message?: string;
  empty?: boolean;
};

export async function executeGitCommit(
  ctx: CloudToolContext,
  params: Record<string, unknown>,
): Promise<CloudToolResult> {
  const message = asString(params.message).trim();
  if (!message) {
    return { content: "Commit message is required.", isError: true };
  }
  try {
    const result = await callControlPlane<CommitToolResponse>(
      ctx,
      `/internal/runs/${encodeURIComponent(ctx.runId)}/scm/commit`,
      {
        method: "POST",
        body: JSON.stringify({ message, paths: asStringList(params.paths) }),
      },
    );
    const branch = result.branch ?? "HEAD";
    const sha = result.sha ?? "unknown";
    return {
      content: result.empty
        ? `Nothing to commit on ${branch}.`
        : `Committed ${sha} on ${branch}.`,
      details: { sha, branch, empty: result.empty === true, message: result.message ?? message },
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "commit failed",
      isError: true,
    };
  }
}

export function createGitCommitTool(ctx: CloudToolContext): CloudToolDefinition {
  return {
    name: "neo_git_commit",
    label: "Neo Git Commit",
    description:
      "Commit workspace changes through the control plane. Do not git commit or git push from bash; the control plane signs the commit and never puts a long-lived git token in the VM.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["message"],
      properties: {
        message: { type: "string", description: "Commit message" },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional paths to stage. Omit to stage all changes.",
        },
      },
    },
    execute: (params) => executeGitCommit(ctx, params),
  };
}

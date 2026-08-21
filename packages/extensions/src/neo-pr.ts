import { asString, callControlPlane } from "./client.js";
import { defineExtension, type CloudToolContext, type CloudToolDefinition, type CloudToolResult } from "./types.js";

export const neoPr = defineExtension({
  name: "neo-pr",
  description: "Ask the control plane to open a draft pull request via POST /internal/runs/:id/scm/pull-request.",
});

export type PullRequestToolResponse = {
  pushed?: boolean;
  pullRequest?: {
    url?: string;
    number?: number | null;
    title?: string;
    draft?: boolean;
    branch?: string;
    repoUrl?: string;
  };
};

export async function executeOpenPullRequest(
  ctx: CloudToolContext,
  params: Record<string, unknown>,
): Promise<CloudToolResult> {
  const title = asString(params.title).trim();
  if (!title) {
    return { content: "Pull request title is required.", isError: true };
  }
  try {
    const result = await callControlPlane<PullRequestToolResponse>(
      ctx,
      `/internal/runs/${encodeURIComponent(ctx.runId)}/scm/pull-request`,
      {
        method: "POST",
        body: JSON.stringify({
          title,
          body: asString(params.body).trim() || undefined,
        }),
      },
    );
    const pr = result.pullRequest ?? {};
    const url = pr.url ?? "local://pr";
    return {
      content: [
        pr.draft === false ? "Opened pull request" : "Opened draft pull request",
        url,
        result.pushed === false ? "(not pushed; no GitHub remote or token)" : "",
      ]
        .filter(Boolean)
        .join(" "),
      details: {
        url,
        number: pr.number ?? null,
        title: pr.title ?? title,
        draft: pr.draft !== false,
        branch: pr.branch,
        repoUrl: pr.repoUrl,
        pushed: result.pushed === true,
      },
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "pull request failed",
      isError: true,
    };
  }
}

export function createPullRequestTool(ctx: CloudToolContext): CloudToolDefinition {
  return {
    name: "neo_pr_open",
    label: "Neo Open Pull Request",
    description:
      "Ask the control plane to push the run branch and open a draft pull request. Do not create GitHub PRs with curl or gh; the control plane holds the GitHub App token.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: {
        title: { type: "string", description: "Pull request title" },
        body: { type: "string", description: "Optional pull request body" },
      },
    },
    execute: (params) => executeOpenPullRequest(ctx, params),
  };
}

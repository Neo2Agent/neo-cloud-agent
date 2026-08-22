import { parseSubscriptionEvents, SUBSCRIPTION_TOOL_NAME, type RunSubscription } from "@neo-cloud-agent/contracts";
import { callControlPlane } from "./client.js";
import { defineExtension, type CloudToolContext, type CloudToolDefinition, type CloudToolResult } from "./types.js";

export const neoSubscribe = defineExtension({
  name: "neo-subscribe",
  description: "Ask the control plane to watch GitHub PR comments or Actions for this run.",
});

export type SubscribeToolResponse = {
  subscriptions?: RunSubscription[];
  created?: RunSubscription[];
  webhook?: { path?: string; configured?: boolean };
};

function describeSubscription(item: RunSubscription): string {
  const target = item.prNumber ? `${item.repo}#${item.prNumber}` : item.repo;
  const branch = item.branch ? ` (${item.branch})` : "";
  const kind = item.kind === "github_ci" ? "Actions CI" : "PR activity";
  return `${kind} on ${target}${branch}`;
}

export async function executeSubscribe(
  ctx: CloudToolContext,
  params: Record<string, unknown>,
): Promise<CloudToolResult> {
  const events = parseSubscriptionEvents(params.events ?? params.event);
  try {
    const result = await callControlPlane<SubscribeToolResponse>(
      ctx,
      `/internal/runs/${encodeURIComponent(ctx.runId)}/subscriptions`,
      {
        method: "POST",
        body: JSON.stringify({ events }),
      },
    );
    const created = result.created ?? result.subscriptions ?? [];
    if (created.length === 0) {
      return {
        content: "No GitHub repository on this run. Attach a github.com repo or open a pull request first.",
        isError: true,
      };
    }
    const webhook = result.webhook?.path ?? "/webhooks/github";
    return {
      content: [
        "Subscribed.",
        ...created.map((item) => `- ${describeSubscription(item)}`),
        `GitHub should POST to ${webhook}. End the turn; review comments and Actions arrive as follow-ups.`,
        result.webhook?.configured === false ? "Webhook secret is not configured on the control plane yet." : "",
      ]
        .filter(Boolean)
        .join("\n"),
      details: {
        events,
        subscriptions: result.subscriptions ?? created,
        webhook,
      },
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "subscribe failed",
      isError: true,
    };
  }
}

export function createSubscribeTool(ctx: CloudToolContext): CloudToolDefinition {
  return {
    name: SUBSCRIPTION_TOOL_NAME,
    label: "Neo Subscribe",
    description:
      "Watch this run's GitHub pull request review comments and/or GitHub Actions. Call this, then end the turn. Do not poll with bash, gh, or curl. events defaults to both pr_activity and ci.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        events: {
          type: "array",
          description: "pr_activity (review comments) and/or ci (GitHub Actions). Default both.",
          items: { type: "string", enum: ["pr_activity", "ci"] },
        },
      },
    },
    execute: (params) => executeSubscribe(ctx, params ?? {}),
  };
}

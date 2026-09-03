import {
  MEMORY_ADD_TOOL_NAME,
  MEMORY_SEARCH_LIMIT_DEFAULT,
  MEMORY_SEARCH_TOOL_NAME,
  type MemoryItem,
} from "@neo-cloud-agent/contracts";
import { asString, callControlPlane } from "./client.js";
import { defineExtension, type CloudToolContext, type CloudToolDefinition, type CloudToolResult } from "./types.js";

export const neoMemory = defineExtension({
  name: "neo-memory",
  description: "Read and write user facts through the control plane Mem0 proxy. Keys stay off the VM.",
});

export type MemoryToolResponse = {
  memories?: MemoryItem[];
};

function formatMemories(items: MemoryItem[]): string {
  if (items.length === 0) {
    return "No matching memories.";
  }
  return items.map((item) => `- ${item.text}`).join("\n");
}

export async function executeMemoryAdd(
  ctx: CloudToolContext,
  params: Record<string, unknown>,
): Promise<CloudToolResult> {
  const text = asString(params.text).trim();
  if (!text) {
    return { content: "text is required", isError: true };
  }
  try {
    const result = await callControlPlane<MemoryToolResponse>(
      ctx,
      `/internal/runs/${encodeURIComponent(ctx.runId)}/memories`,
      {
        method: "POST",
        body: JSON.stringify({ action: "add", text }),
      },
    );
    const memories = result.memories ?? [];
    return {
      content: ["Saved to user memory.", memories.length > 0 ? formatMemories(memories) : `- ${text}`]
        .filter(Boolean)
        .join("\n"),
      details: { text, memories },
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "memory add failed",
      isError: true,
    };
  }
}

export async function executeMemorySearch(
  ctx: CloudToolContext,
  params: Record<string, unknown>,
): Promise<CloudToolResult> {
  const query = asString(params.query).trim();
  if (!query) {
    return { content: "query is required", isError: true };
  }
  const limitRaw = params.limit;
  const limit = typeof limitRaw === "number" && Number.isFinite(limitRaw) ? Math.round(limitRaw) : undefined;
  try {
    const result = await callControlPlane<MemoryToolResponse>(
      ctx,
      `/internal/runs/${encodeURIComponent(ctx.runId)}/memories`,
      {
        method: "POST",
        body: JSON.stringify({ action: "search", query, limit }),
      },
    );
    const memories = result.memories ?? [];
    return {
      content: formatMemories(memories),
      details: { query, memories },
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "memory search failed",
      isError: true,
    };
  }
}

export function createMemoryAddTool(ctx: CloudToolContext): CloudToolDefinition {
  return {
    name: MEMORY_ADD_TOOL_NAME,
    label: "Neo Memory Add",
    description:
      "Persist one concise user fact (preference, constraint, name) through the control plane. Call this when the user asks you to remember something. Do not claim you saved a fact unless this tool succeeds. Keys stay off the VM.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        text: {
          type: "string",
          description: "One short fact to store, in the user's language.",
        },
      },
    },
    execute: (params) => executeMemoryAdd(ctx, params ?? {}),
  };
}

export function createMemorySearchTool(ctx: CloudToolContext): CloudToolDefinition {
  return {
    name: MEMORY_SEARCH_TOOL_NAME,
    label: "Neo Memory Search",
    description:
      "Search this user's persisted facts. Call this when they ask what you remember or what they prefer. Recalled boot facts may also appear in the system prompt.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "What to look up, for example 包管理器 or preferred language.",
        },
        limit: {
          type: "integer",
          description: `Max hits. Default ${MEMORY_SEARCH_LIMIT_DEFAULT}.`,
        },
      },
    },
    execute: (params) => executeMemorySearch(ctx, params ?? {}),
  };
}

import {
  SUBAGENT_TOOL_NAME,
  listSubagentNames,
  mergeSubagentDefinitions,
  parseAgentMarkdown,
  parseSubagentRequest,
  type SubagentDefinition,
} from "@neo-cloud-agent/contracts";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { defineExtension, type CloudToolContext, type CloudToolDefinition, type CloudToolResult } from "./types.js";

export const neoSubagent = defineExtension({
  name: "neo-subagent",
  description: "Delegate isolated work to scout/planner/reviewer/worker using pi's subagent contract.",
});

const PROJECT_AGENT_DIRS = [".pi/agents", ".cursor/agents", ".neo/agents"];

export function loadProjectSubagents(workspaceDir: string): SubagentDefinition[] {
  const found: SubagentDefinition[] = [];
  for (const relative of PROJECT_AGENT_DIRS) {
    const dir = path.resolve(workspaceDir, relative);
    let entries: string[] = [];
    try {
      if (!statSync(dir).isDirectory()) {
        continue;
      }
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".md")) {
        continue;
      }
      try {
        const filePath = path.join(dir, name);
        const parsed = parseAgentMarkdown(readFileSync(filePath, "utf8"), filePath);
        if (parsed) {
          found.push(parsed);
        }
      } catch {
        // skip unreadable agent files
      }
    }
  }
  return found;
}

export function availableSubagents(workspaceDir: string): SubagentDefinition[] {
  return mergeSubagentDefinitions(loadProjectSubagents(workspaceDir));
}

export async function executeSubagentTool(
  ctx: CloudToolContext,
  params: Record<string, unknown>,
): Promise<CloudToolResult> {
  const parsed = parseSubagentRequest(params);
  if ("error" in parsed) {
    return { content: parsed.error, isError: true };
  }
  if (!ctx.runSubagent) {
    const agents = availableSubagents(ctx.workspaceDir);
    return {
      content: `neo_subagent is only available inside the worker session. Known agents: ${listSubagentNames(agents)}`,
      isError: true,
      details: { agents: agents.map((agent) => agent.name) },
    };
  }
  return ctx.runSubagent(params);
}

export function createSubagentTool(ctx: CloudToolContext): CloudToolDefinition {
  const agents = availableSubagents(ctx.workspaceDir);
  const names = agents.map((agent) => agent.name).join(", ");
  return {
    name: SUBAGENT_TOOL_NAME,
    label: "Neo Subagent",
    description:
      `Delegate a self-contained task to an isolated subagent (pi subagent contract). ` +
      `Single: { agent, task }. Parallel: { tasks: [{ agent, task }] }. Chain: { chain: [{ agent, task }] } with {previous}. ` +
      `Agents: ${names}. Child does not see this conversation. Do not use for a single file read.`,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        agent: { type: "string", description: "Single-mode agent name (scout, planner, reviewer, worker, or project)." },
        task: { type: "string", description: "Single-mode self-contained task text." },
        tasks: {
          type: "array",
          description: "Parallel tasks. Max 8, 2 concurrent.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["agent", "task"],
            properties: {
              agent: { type: "string" },
              task: { type: "string" },
            },
          },
        },
        chain: {
          type: "array",
          description: "Sequential steps. {previous} is replaced with the prior step's output.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["agent", "task"],
            properties: {
              agent: { type: "string" },
              task: { type: "string" },
            },
          },
        },
      },
    },
    execute: (params) => executeSubagentTool(ctx, params),
  };
}

import { formatSkillsForPrompt, type AgentSession } from "@earendil-works/pi-coding-agent";
import {
  assembleContextUsage,
  contextUsageToData,
  type ContextUsageSnapshot,
} from "@neo-cloud-agent/contracts";
import { CLOUD_SYSTEM_PROMPT, CLOUD_TOOL_NAMES, FILE_TOOL_NAMES } from "./cloud-tools.js";
import { gatewayModelSpec } from "./model-spec.js";
import type { SessionContextSources } from "./session.js";

function textFromUnknown(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(textFromUnknown).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (record.content !== undefined) {
      return textFromUnknown(record.content);
    }
    if (typeof record.summary === "string") {
      return record.summary;
    }
    if (typeof record.delta === "string") {
      return record.delta;
    }
  }
  return "";
}

const BUILTIN_TOOLS = new Set<string>(FILE_TOOL_NAMES);
const CLOUD_TOOLS = new Set<string>(CLOUD_TOOL_NAMES);

interface ToolTexts {
  tools: string;
  cloudTools: string;
  mcp: string;
}

/**
 * Anything that is neither a pi builtin nor a neo cloud tool falls into `mcp`.
 * A plain intersection would silently drop dynamically registered tools, and
 * the shortfall would disappear into the `system` difference unnoticed.
 */
function serializeTools(session: AgentSession): ToolTexts {
  const groups: ToolTexts = { tools: "", cloudTools: "", mcp: "" };
  let all: ReturnType<AgentSession["getAllTools"]>;
  try {
    all = session.getAllTools();
  } catch {
    return groups;
  }
  const lines: Record<keyof ToolTexts, string[]> = { tools: [], cloudTools: [], mcp: [] };
  for (const tool of all) {
    const schema = tool.parameters ? JSON.stringify(tool.parameters) : "";
    const guide = tool.promptGuidelines ? String(tool.promptGuidelines) : "";
    const key: keyof ToolTexts = BUILTIN_TOOLS.has(tool.name)
      ? "tools"
      : CLOUD_TOOLS.has(tool.name)
        ? "cloudTools"
        : "mcp";
    lines[key].push(`${tool.name}\n${tool.description}\n${schema}\n${guide}`);
  }
  return {
    tools: lines.tools.join("\n"),
    cloudTools: lines.cloudTools.join("\n"),
    mcp: lines.mcp.join("\n"),
  };
}

/** Mirrors how pi wraps AGENTS.md into the system prompt, so the estimate matches. */
function serializeAgentsFiles(sources?: SessionContextSources): string {
  if (!sources) {
    return "";
  }
  try {
    const files = sources.resourceLoader.getAgentsFiles().agentsFiles;
    if (files.length === 0) {
      return "";
    }
    const body = files
      .map((file) => `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`)
      .join("");
    return `\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n${body}</project_context>\n`;
  } catch {
    return "";
  }
}

/** AGENTS.md plus the neo-side rule layers, all of which live in the system prompt. */
function serializeRules(sources?: SessionContextSources): string {
  const layers = sources?.promptLayers;
  return [serializeAgentsFiles(sources), layers?.projectInstruction ?? "", layers?.expertRole ?? ""]
    .filter(Boolean)
    .join("\n");
}

function serializeMemory(sources?: SessionContextSources): string {
  return sources?.promptLayers.userMemory ?? "";
}

function serializeSkills(sources?: SessionContextSources): string {
  if (!sources) {
    return "";
  }
  try {
    return formatSkillsForPrompt(sources.resourceLoader.getSkills().skills);
  } catch {
    return "";
  }
}

function serializeMessages(session: AgentSession): string {
  try {
    return session.messages.map((message) => textFromUnknown(message)).join("\n");
  } catch {
    return "";
  }
}

function serializeSummaries(session: AgentSession): string {
  try {
    return session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "compaction" || entry.type === "branch_summary")
      .map((entry) => ("summary" in entry ? String(entry.summary ?? "") : ""))
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

function sessionWindow(session: AgentSession, modelId: string): number | null {
  try {
    const usage = session.getContextUsage();
    if (usage && usage.contextWindow > 0) {
      return usage.contextWindow;
    }
  } catch {
    // older / unset
  }
  const modelWindow = session.model?.contextWindow;
  if (typeof modelWindow === "number" && modelWindow > 0) {
    return modelWindow;
  }
  return gatewayModelSpec(modelId).contextWindow || null;
}

function sessionReportedTokens(session: AgentSession, fallback?: number): number | null {
  try {
    const usage = session.getContextUsage();
    if (usage && typeof usage.tokens === "number" && usage.tokens > 0) {
      return usage.tokens;
    }
  } catch {
    // fall through
  }
  return typeof fallback === "number" && fallback > 0 ? fallback : null;
}

export function inspectSessionContext(
  session: AgentSession,
  input: { modelId: string; reportedTokens?: number; contextSources?: SessionContextSources },
): ContextUsageSnapshot {
  const toolTexts = serializeTools(session);
  return assembleContextUsage({
    model: input.modelId,
    contextWindow: sessionWindow(session, input.modelId),
    reportedTokens: sessionReportedTokens(session, input.reportedTokens),
    systemText: session.systemPrompt || CLOUD_SYSTEM_PROMPT,
    rulesText: serializeRules(input.contextSources),
    memoryText: serializeMemory(input.contextSources),
    skillsText: serializeSkills(input.contextSources),
    toolsText: toolTexts.tools,
    cloudToolsText: toolTexts.cloudTools,
    mcpText: toolTexts.mcp,
    summarizedText: serializeSummaries(session),
    conversationText: serializeMessages(session),
    source: "session",
  });
}

export function contextUsageEventData(snapshot: ContextUsageSnapshot): Record<string, unknown> {
  return contextUsageToData(snapshot);
}

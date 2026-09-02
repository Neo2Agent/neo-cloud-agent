import { formatSkillsForPrompt, type AgentSession } from "@earendil-works/pi-coding-agent";
import {
  assembleContextUsage,
  contextUsageToData,
  type ContextUsageItemDraft,
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

interface ToolGroup {
  text: string;
  items: ContextUsageItemDraft[];
}

interface ToolTexts {
  tools: ToolGroup;
  cloudTools: ToolGroup;
  mcp: ToolGroup;
}

/**
 * Anything that is neither a pi builtin nor a neo cloud tool falls into `mcp`.
 * A plain intersection would silently drop dynamically registered tools, and
 * the shortfall would disappear into the `system` difference unnoticed.
 */
function emptyGroup(): ToolGroup {
  return { text: "", items: [] };
}

function serializeTools(session: AgentSession): ToolTexts {
  const groups: ToolTexts = { tools: emptyGroup(), cloudTools: emptyGroup(), mcp: emptyGroup() };
  let all: ReturnType<AgentSession["getAllTools"]>;
  try {
    all = session.getAllTools();
  } catch {
    return groups;
  }
  const lines: Record<keyof ToolTexts, string[]> = { tools: [], cloudTools: [], mcp: [] };
  const items: Record<keyof ToolTexts, ContextUsageItemDraft[]> = { tools: [], cloudTools: [], mcp: [] };
  for (const tool of all) {
    let schema = "";
    try {
      schema = tool.parameters ? JSON.stringify(tool.parameters) : "";
    } catch {
      schema = String(tool.parameters ?? "");
    }
    const guide = tool.promptGuidelines ? String(tool.promptGuidelines) : "";
    const text = `${tool.name}\n${tool.description}\n${schema}\n${guide}`;
    const key: keyof ToolTexts = BUILTIN_TOOLS.has(tool.name)
      ? "tools"
      : CLOUD_TOOLS.has(tool.name)
        ? "cloudTools"
        : "mcp";
    lines[key].push(text);
    items[key].push({ id: tool.name, label: tool.name, text });
  }
  return {
    tools: { text: lines.tools.join("\n"), items: items.tools },
    cloudTools: { text: lines.cloudTools.join("\n"), items: items.cloudTools },
    mcp: { text: lines.mcp.join("\n"), items: items.mcp },
  };
}

function fileLabel(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

/** Mirrors how pi wraps AGENTS.md into the system prompt, so the estimate matches. */
function serializeAgentsFiles(sources?: SessionContextSources): {
  text: string;
  items: ContextUsageItemDraft[];
} {
  if (!sources) {
    return { text: "", items: [] };
  }
  try {
    const files = sources.resourceLoader.getAgentsFiles().agentsFiles;
    if (files.length === 0) {
      return { text: "", items: [] };
    }
    const items = files.map((file) => ({
      id: file.path,
      label: fileLabel(file.path),
      text: `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`,
    }));
    const body = items.map((item) => item.text).join("");
    return {
      text: `\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n${body}</project_context>\n`,
      items,
    };
  } catch {
    return { text: "", items: [] };
  }
}

function serializeRules(sources?: SessionContextSources): {
  text: string;
  items: ContextUsageItemDraft[];
} {
  const layers = sources?.promptLayers;
  const files = serializeAgentsFiles(sources);
  const extras: ContextUsageItemDraft[] = [];
  if (layers?.projectInstruction) {
    extras.push({ id: "project", label: "PROJECT.md", text: layers.projectInstruction });
  }
  if (layers?.expertRole) {
    extras.push({ id: "expert", label: "专家角色", text: layers.expertRole });
  }
  return {
    text: [files.text, layers?.projectInstruction ?? "", layers?.expertRole ?? ""].filter(Boolean).join("\n"),
    items: [...files.items, ...extras],
  };
}

function serializeMemory(sources?: SessionContextSources): string {
  return sources?.promptLayers.userMemory ?? "";
}

function serializeSkills(sources?: SessionContextSources): {
  text: string;
  items: ContextUsageItemDraft[];
} {
  if (!sources) {
    return { text: "", items: [] };
  }
  try {
    const skills = sources.resourceLoader.getSkills().skills;
    return {
      text: formatSkillsForPrompt(skills),
      items: skills
        .filter((skill) => !skill.disableModelInvocation)
        .map((skill) => ({
          id: skill.name,
          label: skill.name,
          text: `  <skill>\n    <name>${skill.name}</name>\n    <description>${skill.description}</description>\n    <location>${skill.filePath}</location>\n  </skill>`,
        })),
    };
  } catch {
    return { text: "", items: [] };
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
  const rules = serializeRules(input.contextSources);
  const skills = serializeSkills(input.contextSources);
  return assembleContextUsage({
    model: input.modelId,
    contextWindow: sessionWindow(session, input.modelId),
    reportedTokens: sessionReportedTokens(session, input.reportedTokens),
    systemText: session.systemPrompt || CLOUD_SYSTEM_PROMPT,
    rulesText: rules.text,
    memoryText: serializeMemory(input.contextSources),
    skillsText: skills.text,
    toolsText: toolTexts.tools.text,
    cloudToolsText: toolTexts.cloudTools.text,
    mcpText: toolTexts.mcp.text,
    ruleItems: rules.items,
    skillItems: skills.items,
    toolItems: toolTexts.tools.items,
    cloudToolItems: toolTexts.cloudTools.items,
    mcpItems: toolTexts.mcp.items,
    summarizedText: serializeSummaries(session),
    conversationText: serializeMessages(session),
    source: "session",
  });
}

export function contextUsageEventData(snapshot: ContextUsageSnapshot): Record<string, unknown> {
  return contextUsageToData(snapshot);
}

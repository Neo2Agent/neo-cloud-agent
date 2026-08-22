import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  assembleContextUsage,
  contextUsageToData,
  type ContextUsageSnapshot,
} from "@neo-cloud-agent/contracts";
import { CLOUD_SYSTEM_PROMPT } from "./cloud-tools.js";
import { gatewayModelSpec } from "./model-spec.js";

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

function serializeTools(session: AgentSession): string {
  try {
    return session
      .getAllTools()
      .map((tool) => {
        const schema = tool.parameters ? JSON.stringify(tool.parameters) : "";
        const guide = tool.promptGuidelines ? String(tool.promptGuidelines) : "";
        return `${tool.name}\n${tool.description}\n${schema}\n${guide}`;
      })
      .join("\n");
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
  input: { modelId: string; reportedTokens?: number },
): ContextUsageSnapshot {
  return assembleContextUsage({
    model: input.modelId,
    contextWindow: sessionWindow(session, input.modelId),
    reportedTokens: sessionReportedTokens(session, input.reportedTokens),
    systemText: session.systemPrompt || CLOUD_SYSTEM_PROMPT,
    toolsText: serializeTools(session),
    summarizedText: serializeSummaries(session),
    conversationText: serializeMessages(session),
    source: "session",
  });
}

export function contextUsageEventData(snapshot: ContextUsageSnapshot): Record<string, unknown> {
  return contextUsageToData(snapshot);
}

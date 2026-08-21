import type { RunEvent, RunEventKind } from "@neo-cloud-agent/contracts";

export interface LooseAgentEvent {
  type: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
  result?: unknown;
  partialResult?: unknown;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
}

const TOOL_OUTPUT_LIMIT = 8000;

function collectText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(collectText).filter(Boolean).join("");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (record.content !== undefined) {
      return collectText(record.content);
    }
  }
  return "";
}

function clipOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_LIMIT) {
    return text;
  }
  return `${text.slice(0, TOOL_OUTPUT_LIMIT)}\n… (${text.length - TOOL_OUTPUT_LIMIT} more bytes)`;
}

function collectDetails(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const details = (value as { details?: unknown }).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return undefined;
  }
  return details as Record<string, unknown>;
}

function toolPayload(event: LooseAgentEvent, output?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    toolName: event.toolName,
    toolCallId: event.toolCallId,
    args: event.args,
  };
  if (output) {
    payload.output = clipOutput(output);
  }
  const details = collectDetails(event.result) ?? collectDetails(event.partialResult);
  if (details) {
    payload.details = details;
  }
  return payload;
}

function makeEvent(runId: string, kind: RunEventKind, title: string, data?: Record<string, unknown>): RunEvent {
  return {
    id: crypto.randomUUID(),
    runId,
    createdAt: new Date().toISOString(),
    category: "agent_run",
    level: kind === "tool.end" && data?.isError ? "error" : "info",
    kind,
    title,
    data,
  };
}

/** Map a pi AgentSession event onto one or more control-plane RunEvents. */
export function toRunEvents(runId: string, event: LooseAgentEvent): RunEvent[] {
  switch (event.type) {
    case "agent_start":
      return [makeEvent(runId, "agent.start", "Agent turn started")];
    case "agent_end":
      return [makeEvent(runId, "agent.end", "Agent turn finished")];
    case "message_start":
      return [makeEvent(runId, "message.start", "Assistant message started")];
    case "message_update": {
      if (event.assistantMessageEvent?.type === "text_delta" && event.assistantMessageEvent.delta) {
        return [
          makeEvent(runId, "message.delta", "Assistant text", {
            delta: event.assistantMessageEvent.delta,
          }),
        ];
      }
      return [];
    }
    case "message_end":
      return [makeEvent(runId, "message.end", "Assistant message completed")];
    case "tool_execution_start":
      return [
        makeEvent(runId, "tool.start", `Tool ${event.toolName ?? "unknown"}`, toolPayload(event)),
      ];
    case "tool_execution_update":
      return [
        makeEvent(
          runId,
          "tool.update",
          `Tool ${event.toolName ?? "unknown"}`,
          toolPayload(event, collectText(event.partialResult)),
        ),
      ];
    case "tool_execution_end":
      return [
        makeEvent(runId, "tool.end", `Tool ${event.toolName ?? "unknown"} finished`, {
          ...toolPayload(event, collectText(event.result)),
          isError: event.isError === true,
        }),
      ];
    default:
      return [];
  }
}

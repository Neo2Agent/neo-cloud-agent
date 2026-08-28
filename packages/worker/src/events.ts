import type { ContextUsageSnapshot, RunEvent, RunEventKind, RunEventLevel } from "@neo-cloud-agent/contracts";
import { contextUsageToData } from "@neo-cloud-agent/contracts";

export interface LooseAgentEvent {
  type: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
  result?: unknown;
  partialResult?: unknown;
  usage?: unknown;
  tokenUsage?: unknown;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
  error?: unknown;
  message?: string;
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

function makeEvent(
  runId: string,
  kind: RunEventKind,
  title: string,
  data?: Record<string, unknown>,
  extra?: { level?: RunEventLevel; detail?: string },
): RunEvent {
  return {
    id: crypto.randomUUID(),
    runId,
    createdAt: new Date().toISOString(),
    category: "agent_run",
    level: extra?.level ?? (kind === "llm.error" || (kind === "tool.end" && data?.isError) ? "error" : "info"),
    kind,
    title,
    detail: extra?.detail,
    data,
  };
}

export function emptyAgentTurnEvent(runId: string): RunEvent {
  return makeEvent(
    runId,
    "llm.error",
    "模型没有返回内容",
    { reason: "empty_turn" },
    {
      level: "error",
      detail: "上游拒绝了这次请求，或额度预扣失败。再发一条即可重试。",
    },
  );
}

export function contextUsageEvent(runId: string, snapshot: ContextUsageSnapshot): RunEvent {
  return makeEvent(runId, "context.usage", "Context usage", contextUsageToData(snapshot));
}

/** True end of one user turn, after session.prompt / followUp / steer returns. */
export function turnFinishedEvent(runId: string): RunEvent {
  return makeEvent(runId, "agent.end", "Agent turn finished");
}

/**
 * One desk run is served by a fresh process per turn, so a sequence number only
 * means something next to this epoch. Without it the second turn's events would
 * sort in front of the first turn's.
 */
const WORKER_EPOCH = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function stampWorkerSeq(events: RunEvent[], next: { value: number }): RunEvent[] {
  return events.map((event) => ({
    ...event,
    data: { ...event.data, workerSeq: ++next.value, workerEpoch: WORKER_EPOCH },
  }));
}

export type RunEventMapOptions = {
  nest?: { id: string; agent: string };
};

function withNest(data: Record<string, unknown> | undefined, nest?: { id: string; agent: string }): Record<string, unknown> | undefined {
  if (!nest) {
    return data;
  }
  return {
    ...(data ?? {}),
    subagentId: nest.id,
    subagent: nest.agent,
    details: {
      ...((data?.details as Record<string, unknown> | undefined) ?? {}),
      subagent: nest.agent,
      subagentId: nest.id,
    },
  };
}

/** Map a pi AgentSession event onto one or more control-plane RunEvents. */
export function toRunEvents(runId: string, event: LooseAgentEvent, options?: RunEventMapOptions): RunEvent[] {
  const nest = options?.nest;
  switch (event.type) {
    case "agent_start":
      if (nest) {
        return [];
      }
      return [makeEvent(runId, "agent.start", "Agent turn started")];
    case "agent_end": {
      // pi fires this after every LLM round (between tools). The worker emits
      // a single agent.end after session.prompt returns — that is the turn.
      const usage = collectUsage(event);
      return usage ? [makeEvent(runId, "llm.usage", "Token usage", withNest(usage, nest))] : [];
    }
    case "message_start":
      if (nest) {
        return [];
      }
      return [makeEvent(runId, "message.start", "Assistant message started")];
    case "message_update": {
      if (nest) {
        return [];
      }
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
      if (nest) {
        return [];
      }
      return [makeEvent(runId, "message.end", "Assistant message completed")];
    case "tool_execution_start":
      return [
        makeEvent(
          runId,
          "tool.start",
          nest ? `${nest.agent} · ${event.toolName ?? "unknown"}` : `Tool ${event.toolName ?? "unknown"}`,
          withNest(toolPayload(event), nest),
        ),
      ];
    case "tool_execution_update":
      if (nest) {
        return [];
      }
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
        makeEvent(
          runId,
          "tool.end",
          nest ? `${nest.agent} · ${event.toolName ?? "unknown"} finished` : `Tool ${event.toolName ?? "unknown"} finished`,
          withNest(
            {
              ...toolPayload(event, collectText(event.result)),
              isError: event.isError === true,
            },
            nest,
          ),
        ),
      ];
    default: {
      if (event.type === "error" || event.type === "agent_error") {
        const text = collectErrorText(event);
        return [
          makeEvent(runId, "llm.error", "模型调用失败", { error: text }, { level: "error", detail: text }),
        ];
      }
      const usage = collectUsage(event);
      return usage ? [makeEvent(runId, "llm.usage", "Token usage", usage)] : [];
    }
  }
}

function collectErrorText(event: LooseAgentEvent): string {
  if (typeof event.error === "string" && event.error.trim()) {
    return event.error.trim();
  }
  if (event.error instanceof Error && event.error.message.trim()) {
    return event.error.message.trim();
  }
  if (typeof event.message === "string" && event.message.trim()) {
    return event.message.trim();
  }
  return collectText(event.result) || event.type;
}

function collectUsage(event: LooseAgentEvent): Record<string, number> | undefined {
  const raw = event.usage ?? event.tokenUsage;
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const promptTokens = Number(record.input ?? record.inputTokens ?? record.promptTokens ?? record.prompt_tokens ?? 0);
  const completionTokens = Number(
    record.output ?? record.outputTokens ?? record.completionTokens ?? record.completion_tokens ?? 0,
  );
  const totalTokens = Number(record.total ?? record.totalTokens ?? record.total_tokens ?? promptTokens + completionTokens);
  if (!promptTokens && !completionTokens && !totalTokens) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

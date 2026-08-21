import type { RunEvent, RunEventKind } from "@neo-cloud-agent/contracts";

export interface LooseAgentEvent {
  type: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
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
        makeEvent(runId, "tool.start", `Tool ${event.toolName ?? "unknown"}`, {
          toolName: event.toolName,
          args: event.args,
        }),
      ];
    case "tool_execution_update":
      return [makeEvent(runId, "tool.update", `Tool ${event.toolName ?? "unknown"}`, { toolName: event.toolName })];
    case "tool_execution_end":
      return [
        makeEvent(runId, "tool.end", `Tool ${event.toolName ?? "unknown"} finished`, {
          toolName: event.toolName,
          isError: event.isError === true,
        }),
      ];
    default:
      return [];
  }
}

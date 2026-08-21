import type { RunEvent, TranscriptMessage, TranscriptSnapshot } from "@neo-cloud-agent/contracts";

function isSetupKind(kind: string): boolean {
  return (
    kind.startsWith("scm.") ||
    kind.startsWith("run.install") ||
    kind.startsWith("run.start") ||
    kind.startsWith("run.terminal") ||
    kind.startsWith("build.") ||
    kind.startsWith("egress.")
  );
}

export function buildTranscriptSnapshot(runId: string, events: RunEvent[]): TranscriptSnapshot {
  const messages: TranscriptMessage[] = [];
  let assistant: TranscriptMessage | null = null;

  const finishAssistant = () => {
    if (assistant) {
      assistant.streaming = false;
      assistant = null;
    }
  };

  const ensureAssistant = (event: RunEvent): TranscriptMessage => {
    if (!assistant) {
      assistant = {
        id: event.id,
        role: "assistant",
        text: "",
        createdAt: event.createdAt,
        streaming: true,
        tools: [],
      };
      messages.push(assistant);
    }
    return assistant;
  };

  for (const event of events) {
    if (event.kind === "user.message") {
      finishAssistant();
      messages.push({
        id: event.id,
        role: "user",
        text: String(event.data?.text ?? ""),
        createdAt: event.createdAt,
      });
      continue;
    }
    if (event.kind === "agent.start") {
      finishAssistant();
      continue;
    }
    if (event.kind === "message.start") {
      finishAssistant();
      ensureAssistant(event);
      continue;
    }
    if (event.kind === "message.delta") {
      ensureAssistant(event).text += String(event.data?.delta ?? "");
      continue;
    }
    if (event.kind === "message.end" || event.kind === "agent.end") {
      finishAssistant();
      continue;
    }
    if (event.kind === "tool.start" || event.kind === "tool.end") {
      const current = ensureAssistant(event);
      current.tools ??= [];
      if (event.kind === "tool.end") {
        current.tools.push({
          name: String(event.data?.toolName ?? "tool"),
          isError: event.data?.isError === true,
        });
      }
      continue;
    }
    if (isSetupKind(event.kind)) {
      messages.push({
        id: event.id,
        role: "setup",
        text: event.detail ? `${event.title}：${event.detail}` : event.title,
        createdAt: event.createdAt,
        kind: event.kind,
        level: event.level,
      });
    }
  }

  const last = events.at(-1);
  return {
    runId,
    seq: last?.seq ?? events.length,
    lastEventId: last?.id ?? null,
    messages,
  };
}

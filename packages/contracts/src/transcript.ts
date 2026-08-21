import type { RunEvent, TranscriptBlock, TranscriptMessage, TranscriptSnapshot, TranscriptTool } from "./events.js";

const SETUP_PREFIXES = [
  "scm.",
  "run.install",
  "run.start",
  "run.terminal",
  "run.queued",
  "build.",
  "egress.",
  "artifact.",
  "mcp.",
  "llm.",
];

export function isSetupKind(kind: string): boolean {
  return SETUP_PREFIXES.some((prefix) => kind.startsWith(prefix));
}

function toolKey(event: RunEvent): string {
  const callId = event.data?.toolCallId;
  if (typeof callId === "string" && callId) {
    return callId;
  }
  return event.id;
}

function upsertTool(assistant: TranscriptMessage, event: RunEvent): TranscriptTool {
  assistant.tools ??= [];
  assistant.blocks ??= [];
  const id = toolKey(event);
  const name = String(event.data?.toolName ?? "tool");
  let tool = assistant.tools.find((item) => item.id === id);
  if (!tool) {
    tool = assistant.tools.find((item) => item.name === name && item.status === "running");
  }
  if (!tool) {
    tool = { id, name, status: "running" };
    assistant.tools.push(tool);
    assistant.blocks.push({ type: "tool", tool });
  }
  tool.id = id;
  tool.name = name;
  if (event.data?.args !== undefined) {
    tool.args = event.data.args;
  }
  if (typeof event.data?.output === "string") {
    tool.output = event.data.output;
  }
  if (event.data?.details && typeof event.data.details === "object") {
    tool.details = event.data.details as Record<string, unknown>;
  }
  if (event.kind === "tool.end") {
    tool.status = "done";
    tool.isError = event.data?.isError === true;
  }
  return tool;
}

function appendText(assistant: TranscriptMessage, delta: string): void {
  if (!delta) {
    return;
  }
  assistant.text += delta;
  assistant.blocks ??= [];
  const last = assistant.blocks.at(-1);
  if (last?.type === "text") {
    last.text += delta;
    return;
  }
  assistant.blocks.push({ type: "text", text: delta });
}

export function transcriptBlocks(message: TranscriptMessage): TranscriptBlock[] {
  if (message.blocks && message.blocks.length > 0) {
    return message.blocks.filter((block) => block.type !== "text" || block.text.trim().length > 0);
  }
  const blocks: TranscriptBlock[] = [];
  if (message.text.trim()) {
    blocks.push({ type: "text", text: message.text });
  }
  for (const tool of message.tools ?? []) {
    blocks.push({ type: "tool", tool });
  }
  return blocks;
}

/** Compact catch-up view so a late subscriber does not replay every token. */
export function buildTranscriptSnapshot(runId: string, events: RunEvent[]): TranscriptSnapshot {
  const messages: TranscriptMessage[] = [];
  const open: { assistant: TranscriptMessage | null } = { assistant: null };

  const finishAssistant = () => {
    const assistant = open.assistant;
    if (!assistant) {
      return;
    }
    assistant.streaming = false;
    if (!assistant.text && !(assistant.tools && assistant.tools.length > 0)) {
      const index = messages.lastIndexOf(assistant);
      if (index >= 0) {
        messages.splice(index, 1);
      }
    }
    open.assistant = null;
  };

  const ensureAssistant = (event: RunEvent): TranscriptMessage => {
    if (!open.assistant) {
      open.assistant = {
        id: event.id,
        role: "assistant",
        text: "",
        createdAt: event.createdAt,
        streaming: true,
        tools: [],
        blocks: [],
      };
      messages.push(open.assistant);
    }
    return open.assistant;
  };

  for (const event of events) {
    if (event.kind === "user.message") {
      finishAssistant();
      const images = Array.isArray(event.data?.images)
        ? event.data.images.filter(
            (item): item is { mediaType: string; data: string } =>
              Boolean(item) &&
              typeof item === "object" &&
              typeof (item as { mediaType?: unknown }).mediaType === "string" &&
              typeof (item as { data?: unknown }).data === "string",
          )
        : undefined;
      messages.push({
        id: event.id,
        role: "user",
        text: String(event.data?.text ?? ""),
        createdAt: event.createdAt,
        images: images?.length ? images : undefined,
      });
      continue;
    }
    if (event.kind === "agent.start") {
      finishAssistant();
      continue;
    }
    if (event.kind === "message.start") {
      ensureAssistant(event).streaming = true;
      continue;
    }
    if (event.kind === "message.delta") {
      appendText(ensureAssistant(event), String(event.data?.delta ?? ""));
      continue;
    }
    if (event.kind === "message.end") {
      if (open.assistant) {
        open.assistant.streaming = false;
      }
      continue;
    }
    if (event.kind === "agent.end") {
      finishAssistant();
      continue;
    }
    if (event.kind === "tool.start" || event.kind === "tool.update" || event.kind === "tool.end") {
      upsertTool(ensureAssistant(event), event);
      continue;
    }
    if (event.kind === "run.error") {
      const current = ensureAssistant(event);
      appendText(current, current.text ? `\n${event.title}` : event.title);
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
        href: typeof event.data?.url === "string" ? event.data.url : undefined,
        mediaType: typeof event.data?.contentType === "string" ? event.data.contentType : undefined,
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

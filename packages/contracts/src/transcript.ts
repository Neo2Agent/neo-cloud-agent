import type {
  RunEvent,
  TranscriptBlock,
  TranscriptGroup,
  TranscriptMessage,
  TranscriptSnapshot,
  TranscriptTool,
} from "./events.js";

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

function workerSeq(event: RunEvent): number | null {
  const value = event.data?.workerSeq;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Restore emission order when HTTP ingest races or clocks stay close. */
export function sortRunEvents(events: RunEvent[]): RunEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const leftSeq = workerSeq(left.event);
      const rightSeq = workerSeq(right.event);
      if (leftSeq != null && rightSeq != null && leftSeq !== rightSeq) {
        return leftSeq - rightSeq;
      }
      const leftAt = Date.parse(left.event.createdAt) || 0;
      const rightAt = Date.parse(right.event.createdAt) || 0;
      if (leftAt !== rightAt) {
        return leftAt - rightAt;
      }
      return left.index - right.index;
    })
    .map((item) => item.event);
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

function hasAssistantContent(assistant: TranscriptMessage): boolean {
  return Boolean(assistant.text.trim() || (assistant.tools && assistant.tools.length > 0));
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

export function transcriptGroups(message: TranscriptMessage): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];
  for (const block of transcriptBlocks(message)) {
    if (block.type === "tool") {
      const last = groups.at(-1);
      if (last?.type === "tools") {
        last.tools.push(block.tool);
      } else {
        groups.push({ type: "tools", tools: [block.tool] });
      }
      continue;
    }
    const last = groups.at(-1);
    if (last?.type === "text") {
      last.text += block.text;
    } else {
      groups.push({ type: "text", text: block.text });
    }
  }
  return groups;
}

export const DEFAULT_TRANSCRIPT_PAGE = 40;
export const MAX_TRANSCRIPT_PAGE = 200;

export function clampTranscriptPage(limit?: number | null): number {
  if (limit == null || !Number.isFinite(limit)) {
    return DEFAULT_TRANSCRIPT_PAGE;
  }
  return Math.min(MAX_TRANSCRIPT_PAGE, Math.max(1, Math.floor(limit)));
}

/** Newest-first page of compiled messages. `before` is the first visible id. */
export function pageTranscriptMessages(
  messages: TranscriptMessage[],
  options?: { before?: string | null; limit?: number | null },
): { messages: TranscriptMessage[]; remaining: number; nextBefore: string | null } {
  const limit = clampTranscriptPage(options?.limit);
  const before = options?.before?.trim() || null;
  let end = messages.length;
  if (before) {
    const index = messages.findIndex((item) => item.id === before);
    if (index === -1) {
      return { messages: [], remaining: 0, nextBefore: null };
    }
    end = index;
  }
  const start = Math.max(0, end - limit);
  return {
    messages: messages.slice(start, end),
    remaining: start,
    nextBefore: start > 0 ? (messages[start]?.id ?? null) : null,
  };
}

function cloneTool(tool: TranscriptTool): TranscriptTool {
  return {
    ...tool,
    details: tool.details ? { ...tool.details } : undefined,
  };
}

export function cloneTranscriptMessage(message: TranscriptMessage): TranscriptMessage {
  return {
    ...message,
    tools: message.tools?.map(cloneTool),
    blocks: message.blocks?.map((block) =>
      block.type === "tool" ? { type: "tool" as const, tool: cloneTool(block.tool) } : { ...block },
    ),
    images: message.images?.map((image) => ({ ...image })),
  };
}

type BuildState = {
  messages: TranscriptMessage[];
  open: TranscriptMessage | null;
};

function finishAssistant(state: BuildState): void {
  const assistant = state.open;
  if (!assistant) {
    return;
  }
  assistant.streaming = false;
  for (const tool of assistant.tools ?? []) {
    if (tool.status === "running") {
      tool.status = "done";
    }
  }
  if (!hasAssistantContent(assistant)) {
    const index = state.messages.lastIndexOf(assistant);
    if (index >= 0) {
      state.messages.splice(index, 1);
    }
  }
  state.open = null;
}

function ensureAssistant(state: BuildState, event: RunEvent): TranscriptMessage {
  if (!state.open) {
    state.open = {
      id: event.id,
      role: "assistant",
      text: "",
      createdAt: event.createdAt,
      streaming: true,
      tools: [],
      blocks: [],
    };
    state.messages.push(state.open);
  }
  return state.open;
}

function applyEventToState(state: BuildState, event: RunEvent): void {
  if (event.kind === "user.message") {
    finishAssistant(state);
    const images = Array.isArray(event.data?.images)
      ? event.data.images.filter(
          (item): item is { mediaType: string; data: string } =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as { mediaType?: unknown }).mediaType === "string" &&
            typeof (item as { data?: unknown }).data === "string",
        )
      : undefined;
    state.messages.push({
      id: event.id,
      role: "user",
      text: String(event.data?.text ?? ""),
      createdAt: event.createdAt,
      images: images?.length ? images : undefined,
    });
    return;
  }
  if (event.kind === "agent.start") {
    finishAssistant(state);
    return;
  }
  if (event.kind === "message.start") {
    if (state.open && hasAssistantContent(state.open)) {
      finishAssistant(state);
    }
    ensureAssistant(state, event).streaming = true;
    return;
  }
  if (event.kind === "message.delta") {
    if (state.open?.tools?.length && !state.open.streaming) {
      finishAssistant(state);
    }
    appendText(ensureAssistant(state, event), String(event.data?.delta ?? ""));
    return;
  }
  if (event.kind === "message.end") {
    if (state.open) {
      state.open.streaming = false;
      if (state.open.text.trim()) {
        finishAssistant(state);
      }
    }
    return;
  }
  if (event.kind === "agent.end" || event.kind === "run.idle") {
    finishAssistant(state);
    return;
  }
  if (event.kind === "tool.start" || event.kind === "tool.update" || event.kind === "tool.end") {
    if (state.open?.text.trim() && state.open.streaming === false) {
      finishAssistant(state);
    }
    upsertTool(ensureAssistant(state, event), event);
    return;
  }
  if (event.kind === "run.error") {
    const current = ensureAssistant(state, event);
    appendText(current, current.text ? `\n${event.title}` : event.title);
    finishAssistant(state);
    return;
  }
  if (isSetupKind(event.kind)) {
    state.messages.push({
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

function stateFromMessages(messages: TranscriptMessage[]): BuildState {
  const cloned = messages.map(cloneTranscriptMessage);
  const last = cloned.at(-1);
  const open = last?.role === "assistant" && last.streaming ? last : null;
  return { messages: cloned, open };
}

/** Apply live events onto an already-compiled page without replaying the log. */
export function applyRunEventsToMessages(messages: TranscriptMessage[], events: RunEvent[]): TranscriptMessage[] {
  if (events.length === 0) {
    return messages;
  }
  const state = stateFromMessages(messages);
  for (const event of sortRunEvents(events)) {
    applyEventToState(state, event);
  }
  return state.messages;
}

/** Compact catch-up view so a late subscriber does not replay every token. */
export function buildTranscriptSnapshot(runId: string, events: RunEvent[]): TranscriptSnapshot {
  const state: BuildState = { messages: [], open: null };
  for (const event of sortRunEvents(events)) {
    applyEventToState(state, event);
  }
  const last = events.at(-1);
  return {
    runId,
    seq: last?.seq ?? events.length,
    lastEventId: last?.id ?? null,
    messages: state.messages,
    remaining: 0,
    nextBefore: null,
    total: state.messages.length,
  };
}

export function pageTranscriptSnapshot(
  snapshot: TranscriptSnapshot,
  options?: { before?: string | null; limit?: number | null },
): TranscriptSnapshot {
  const page = pageTranscriptMessages(snapshot.messages, options);
  return {
    ...snapshot,
    messages: page.messages,
    remaining: page.remaining,
    nextBefore: page.nextBefore,
    total: snapshot.total ?? snapshot.messages.length,
  };
}

import type {
  RunEvent,
  TranscriptBlock,
  TranscriptGroup,
  TranscriptMessage,
  TranscriptSnapshot,
  TranscriptTool,
} from "./events.js";
import {
  isNestedSubagentEvent,
  MAX_SUBAGENT_STEPS,
  readSubagentSteps,
  seedSubagentDetails,
  SUBAGENT_TOOL_NAME,
  type SubagentStep,
} from "./subagent.js";

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
  "subscription.",
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
    const incoming = event.data.details as Record<string, unknown>;
    const previous = tool.details ?? {};
    tool.details = {
      ...previous,
      ...incoming,
      steps: Array.isArray(previous.steps) ? previous.steps : incoming.steps,
      tasks: previous.tasks ?? incoming.tasks,
    };
  }
  if (tool.name === SUBAGENT_TOOL_NAME) {
    tool.details = seedSubagentDetails(tool.args, tool.details);
  }
  if (event.kind === "tool.end") {
    tool.status = "done";
    tool.isError = event.data?.isError === true;
  }
  return tool;
}

function touch(message: TranscriptMessage, at: string): void {
  message.updatedAt = at;
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

function cloneDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details) {
    return undefined;
  }
  const next = { ...details };
  if (Array.isArray(next.steps)) {
    next.steps = next.steps.map((step) => (step && typeof step === "object" ? { ...step } : step));
  }
  if (Array.isArray(next.tasks)) {
    next.tasks = next.tasks.map((task) => (task && typeof task === "object" ? { ...task } : task));
  }
  return next;
}

function cloneTool(tool: TranscriptTool): TranscriptTool {
  return {
    ...tool,
    details: cloneDetails(tool.details),
  };
}

export function cloneTranscriptMessage(message: TranscriptMessage): TranscriptMessage {
  const tools = message.tools?.map(cloneTool);
  const byId = new Map((tools ?? []).map((tool) => [tool.id, tool]));
  return {
    ...message,
    tools,
    blocks: message.blocks?.map((block) => {
      if (block.type !== "tool") {
        return { ...block };
      }
      const shared = (block.tool.id && byId.get(block.tool.id)) || cloneTool(block.tool);
      if (block.tool.id) {
        byId.set(block.tool.id, shared);
      }
      return { type: "tool" as const, tool: shared };
    }),
    images: message.images?.map((image) => ({ ...image })),
  };
}

function markToolsDone(assistant: TranscriptMessage): void {
  for (const tool of assistant.tools ?? []) {
    if (tool.status === "running") {
      tool.status = "done";
    }
  }
  for (const block of assistant.blocks ?? []) {
    if (block.type === "tool" && block.tool.status === "running") {
      block.tool.status = "done";
    }
  }
}

export function settleTranscriptMessages(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.map((message) => {
    const next = cloneTranscriptMessage(message);
    if (next.role === "assistant") {
      next.streaming = false;
      markToolsDone(next);
    }
    return next;
  });
}

const RESTART_HEARTBEAT = /heartbeat lost after control plane restart/i;
const SLOT_BUSY_NOTICE = /all VM slots are busy/i;

function isTransientInfraNotice(text: string | undefined): boolean {
  const value = text ?? "";
  return RESTART_HEARTBEAT.test(value) || SLOT_BUSY_NOTICE.test(value);
}

export function isStaleRestartNotice(message: TranscriptMessage, later: TranscriptMessage[]): boolean {
  if (!isTransientInfraNotice(message.text)) {
    return false;
  }
  return later.some(
    (item) =>
      item.role === "user" ||
      (item.role === "assistant" && Boolean(item.text.trim() || item.tools?.length)),
  );
}

export function transcriptHasUnsettledWork(messages: TranscriptMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== "assistant") {
      return false;
    }
    if (message.streaming) {
      return true;
    }
    if (message.tools?.some((tool) => tool.status === "running")) {
      return true;
    }
    return Boolean(message.blocks?.some((block) => block.type === "tool" && block.tool.status === "running"));
  });
}

export function displayTranscriptMessages(
  messages: TranscriptMessage[],
  options?: { hideStaleRestart?: boolean },
): TranscriptMessage[] {
  return messages.filter((message, index) => {
    if (options?.hideStaleRestart && isTransientInfraNotice(message.text)) {
      return false;
    }
    return !isStaleRestartNotice(message, messages.slice(index + 1));
  });
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
  markToolsDone(assistant);
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
      updatedAt: event.createdAt,
      streaming: true,
      tools: [],
      blocks: [],
    };
    state.messages.push(state.open);
  }
  return state.open;
}

function settleAll(state: BuildState, at?: string): void {
  for (const message of state.messages) {
    if (message.role === "assistant") {
      message.streaming = false;
      if (at) {
        touch(message, at);
      }
      markToolsDone(message);
    }
  }
  state.messages = state.messages.filter((message) => message.role !== "assistant" || hasAssistantContent(message));
  state.open = null;
}

function findParentSubagent(state: BuildState): { message: TranscriptMessage; tool: TranscriptTool } | null {
  const pick = (runningOnly: boolean) => {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (message?.role !== "assistant") {
        continue;
      }
      const tools = message.tools ?? [];
      for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
        const tool = tools[toolIndex];
        if (tool?.name !== SUBAGENT_TOOL_NAME) {
          continue;
        }
        if (runningOnly && tool.status !== "running") {
          continue;
        }
        return { message, tool };
      }
    }
    return null;
  };
  return pick(true) ?? pick(false);
}

function upsertNestedStep(parent: TranscriptTool, event: RunEvent): void {
  const id = toolKey(event);
  const name = String(event.data?.toolName ?? "tool");
  const agent = typeof event.data?.subagent === "string" && event.data.subagent ? event.data.subagent : "subagent";
  const subagentId = typeof event.data?.subagentId === "string" ? event.data.subagentId : undefined;
  parent.details = { ...(parent.details ?? {}) };
  const steps: SubagentStep[] = readSubagentSteps(parent.details).map((step) => ({ ...step }));
  let step = steps.find((item) => item.id === id);
  if (!step) {
    step = { id, name, agent, subagentId, status: "running" };
    steps.push(step);
  }
  step.name = name;
  step.agent = agent;
  if (subagentId) {
    step.subagentId = subagentId;
  }
  if (event.data?.args !== undefined) {
    step.args = event.data.args;
  }
  if (typeof event.data?.output === "string") {
    step.output = event.data.output;
  }
  if (event.kind === "tool.end") {
    step.status = "done";
    step.isError = event.data?.isError === true;
  }
  while (steps.length > MAX_SUBAGENT_STEPS) {
    const doneIndex = steps.findIndex((item) => item.status === "done");
    steps.splice(doneIndex >= 0 ? doneIndex : 0, 1);
    parent.details.omittedSteps = Number(parent.details.omittedSteps ?? 0) + 1;
  }
  parent.details.steps = steps;
}

function assistantForTool(state: BuildState, event: RunEvent): TranscriptMessage | null {
  const id = toolKey(event);
  const name = String(event.data?.toolName ?? "tool");
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message?.role !== "assistant") {
      continue;
    }
    const match = message.tools?.find(
      (item) => item.id === id || (item.name === name && item.status === "running"),
    );
    if (match) {
      return message;
    }
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
      updatedAt: event.createdAt,
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
    const assistant = ensureAssistant(state, event);
    assistant.streaming = true;
    touch(assistant, event.createdAt);
    return;
  }
  if (event.kind === "message.delta") {
    if (state.open?.tools?.length && !state.open.streaming) {
      finishAssistant(state);
    }
    const assistant = ensureAssistant(state, event);
    appendText(assistant, String(event.data?.delta ?? ""));
    touch(assistant, event.createdAt);
    return;
  }
  if (event.kind === "message.end") {
    if (state.open) {
      state.open.streaming = false;
      touch(state.open, event.createdAt);
      const busy = state.open.tools?.some((tool) => tool.status === "running");
      if (state.open.text.trim() && !busy) {
        finishAssistant(state);
      }
    }
    return;
  }
  if (event.kind === "agent.end" || event.kind === "run.idle") {
    settleAll(state, event.createdAt);
    return;
  }
  if (event.kind === "tool.start" || event.kind === "tool.update" || event.kind === "tool.end") {
    if (isNestedSubagentEvent(event.data)) {
      const parent = findParentSubagent(state);
      if (!parent) {
        return;
      }
      upsertNestedStep(parent.tool, event);
      state.open = parent.message;
      touch(parent.message, event.createdAt);
      return;
    }
    const existing = assistantForTool(state, event);
    if (existing) {
      state.open = existing;
      upsertTool(existing, event);
      touch(existing, event.createdAt);
      return;
    }
    if (state.open?.text.trim() && state.open.streaming === false) {
      finishAssistant(state);
    }
    const assistant = ensureAssistant(state, event);
    upsertTool(assistant, event);
    touch(assistant, event.createdAt);
    return;
  }
  if (event.kind === "run.error") {
    settleAll(state, event.createdAt);
    state.messages.push({
      id: event.id,
      role: "setup",
      text: event.detail ? `${event.title}：${event.detail}` : event.title,
      createdAt: event.createdAt,
      kind: event.kind,
      level: event.level ?? "error",
    });
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
  const last = [...cloned].reverse().find((item) => item.role === "assistant");
  const open =
    last && (last.streaming || Boolean(last.tools?.some((tool) => tool.status === "running"))) ? last : null;
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

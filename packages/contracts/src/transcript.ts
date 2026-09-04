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
  if (kind === "llm.usage") {
    return false;
  }
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

/**
 * Which worker process emitted this. A desk run is served by one process per
 * turn, and each starts its sequence at 1, so a sequence only orders events
 * from the same process.
 */
function workerEpoch(event: RunEvent): string {
  const value = event.data?.workerEpoch;
  return typeof value === "string" ? value : "";
}

/** Restore emission order when HTTP ingest races or clocks stay close. */
export function sortRunEvents(events: RunEvent[]): RunEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const leftSeq = workerSeq(left.event);
      const rightSeq = workerSeq(right.event);
      const sameProcess = workerEpoch(left.event) === workerEpoch(right.event);
      if (sameProcess && leftSeq != null && rightSeq != null && leftSeq !== rightSeq) {
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
  const fromBlocks = (message.blocks ?? []).filter((block) => block.type !== "text" || block.text.trim().length > 0);
  if (fromBlocks.length === 0) {
    const blocks: TranscriptBlock[] = [];
    if (message.text.trim()) {
      blocks.push({ type: "text", text: message.text });
    }
    for (const tool of message.tools ?? []) {
      blocks.push({ type: "tool", tool });
    }
    return blocks;
  }
  const seen = new Set(
    fromBlocks.filter((block) => block.type === "tool").map((block) => (block.type === "tool" ? block.tool.id || block.tool.name : "")),
  );
  const extra = (message.tools ?? []).filter((tool) => !seen.has(tool.id || tool.name));
  if (extra.length === 0) {
    return fromBlocks;
  }
  return [...fromBlocks, ...extra.map((tool) => ({ type: "tool" as const, tool }))];
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
/** Control plane waiting for a desk to pick the run up. Never user-facing on the desk itself. */
const DESK_CLAIM_NOTICE = /(等待本机 Desk 认领|等待 Desk 认领|已派给这台电脑，等待启动)/;
const INTERRUPTED_QUEUE_NOTICE = /中断的回合已自动排队/;

function isTransientInfraNotice(text: string | undefined): boolean {
  const value = text ?? "";
  return RESTART_HEARTBEAT.test(value) || SLOT_BUSY_NOTICE.test(value);
}

export function isDeskHandshakeNotice(text: string | undefined): boolean {
  const value = text ?? "";
  return DESK_CLAIM_NOTICE.test(value) || INTERRUPTED_QUEUE_NOTICE.test(value);
}

export function isStaleRestartNotice(message: TranscriptMessage, later: TranscriptMessage[]): boolean {
  if (!isTransientInfraNotice(message.text) && !isDeskHandshakeNotice(message.text)) {
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
  options?: {
    hideStaleRestart?: boolean;
    /** This window is the machine, so its own claim handshake is noise. */
    hideDeskHandshake?: boolean;
    hideFollowUpIds?: Iterable<string>;
  },
): TranscriptMessage[] {
  const hidden = options?.hideFollowUpIds ? new Set(options.hideFollowUpIds) : null;
  return messages.filter((message, index) => {
    if (hidden && message.role === "user" && message.followUpId && hidden.has(message.followUpId)) {
      return false;
    }
    if (options?.hideStaleRestart && isTransientInfraNotice(message.text)) {
      return false;
    }
    if (options?.hideDeskHandshake && isDeskHandshakeNotice(message.text)) {
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

function lastTurnAssistant(state: BuildState): TranscriptMessage | null {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message?.role === "user") {
      return null;
    }
    if (message?.role === "assistant") {
      return message;
    }
  }
  return null;
}

function ensureAssistant(state: BuildState, event: RunEvent): TranscriptMessage {
  if (!state.open) {
    const existing = lastTurnAssistant(state);
    if (existing) {
      state.open = existing;
      existing.streaming = true;
      return existing;
    }
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
      const open = message.streaming || Boolean(message.tools?.some((tool) => tool.status === "running"));
      message.streaming = false;
      if (at && open) {
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

function eventImages(event: RunEvent): TranscriptMessage["images"] {
  const images = Array.isArray(event.data?.images)
    ? event.data.images.filter(
        (item): item is { mediaType: string; data: string } =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { mediaType?: unknown }).mediaType === "string" &&
          typeof (item as { data?: unknown }).data === "string",
      )
    : undefined;
  return images?.length ? images : undefined;
}

function applyUserTurn(state: BuildState, event: RunEvent): void {
  const text = String(event.data?.text ?? "");
  const followUpId = typeof event.data?.followUpId === "string" ? event.data.followUpId : undefined;
  const actorUserId = typeof event.data?.actorUserId === "string" ? event.data.actorUserId : undefined;
  const actorEmail = typeof event.data?.actorEmail === "string" ? event.data.actorEmail : undefined;
  const images = eventImages(event);
  const existing = followUpId
    ? state.messages.find((item) => item.role === "user" && item.followUpId === followUpId)
    : undefined;
  if (existing) {
    existing.id = event.id;
    existing.text = text || existing.text;
    existing.updatedAt = event.createdAt;
    existing.actorUserId = actorUserId ?? existing.actorUserId;
    existing.actorEmail = actorEmail ?? existing.actorEmail;
    if (images) {
      existing.images = images;
    }
    return;
  }
  if (!text && event.kind === "followup.queued") {
    return;
  }
  finishAssistant(state);
  state.messages.push({
    id: event.id,
    role: "user",
    text,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    images,
    followUpId,
    actorUserId,
    actorEmail,
  });
}

function applyEventToState(state: BuildState, event: RunEvent): void {
  if (event.kind === "user.message") {
    applyUserTurn(state, event);
    return;
  }
  if (
    event.kind === "followup.queued" &&
    typeof event.data?.followUpId === "string" &&
    String(event.data?.text ?? "").trim()
  ) {
    applyUserTurn(state, event);
    return;
  }
  if (event.kind === "agent.start") {
    // pi emits this for every LLM round. Closing here splits write/read/text
    // into separate Neo avatars. A new bubble starts on the next user.message.
    const open = state.open ?? lastTurnAssistant(state);
    if (open) {
      state.open = open;
      open.streaming = true;
      touch(open, event.createdAt);
    }
    return;
  }
  // One user turn is one reply bubble. The model may alternate text and tools
  // several times inside it; those become blocks, not separate bubbles.
  if (event.kind === "message.start") {
    const assistant = ensureAssistant(state, event);
    assistant.streaming = true;
    touch(assistant, event.createdAt);
    return;
  }
  if (event.kind === "message.delta") {
    const assistant = ensureAssistant(state, event);
    appendText(assistant, String(event.data?.delta ?? ""));
    touch(assistant, event.createdAt);
    return;
  }
  if (event.kind === "message.end") {
    if (state.open) {
      state.open.streaming = false;
      touch(state.open, event.createdAt);
    }
    return;
  }
  if (event.kind === "agent.end") {
    for (const message of state.messages) {
      if (message.role === "assistant") {
        markToolsDone(message);
      }
    }
    const open = state.open ?? lastTurnAssistant(state);
    if (open && !hasAssistantContent(open)) {
      finishAssistant(state);
      return;
    }
    if (open) {
      // More LLM rounds may follow in this user turn. run.idle closes it.
      state.open = open;
      open.streaming = true;
    }
    return;
  }
  if (event.kind === "run.idle") {
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

/**
 * The event stream went quiet, so a client pays for the transcript body only
 * when the run produced a new event. Comparing ids also covers token deltas,
 * which never bump `updatedAt`. A server that reports no cursor keeps the old
 * always-refetch behaviour.
 */
export function transcriptBodyNeeded(input: {
  appliedEventId?: string | null;
  runLastEventId?: string | null;
}): boolean {
  if (!input.runLastEventId) {
    return true;
  }
  return input.runLastEventId !== (input.appliedEventId ?? null);
}

/** Where a chat photo is served, so the list payload never carries a JPEG. */
export function transcriptImagePath(runId: string, messageId: string, index: number): string {
  return `/v1/runs/${encodeURIComponent(runId)}/transcript/images/${encodeURIComponent(messageId)}/${index}`;
}

/**
 * Replace inline base64 with a URL. A phone re-fetches this page whenever the
 * event stream is quiet, and parsing image bytes each time is what makes the
 * chat hitch. Callers that need the bytes keep asking for the plain snapshot.
 */
export function slimTranscriptSnapshotImages(snapshot: TranscriptSnapshot): TranscriptSnapshot {
  let changed = false;
  const messages = snapshot.messages.map((message) => {
    if (!message.images?.length) {
      return message;
    }
    changed = true;
    return {
      ...message,
      images: message.images.map((image, index) => ({
        mediaType: image.mediaType,
        data: "",
        href: image.href || transcriptImagePath(snapshot.runId, message.id, index),
      })),
    };
  });
  return changed ? { ...snapshot, messages } : snapshot;
}

/** Strip a `data:` prefix so the payload is plain base64. */
export function rawTranscriptImageData(data: string): string {
  const trimmed = data.trim();
  return trimmed.includes(",") ? trimmed.slice(trimmed.indexOf(",") + 1) : trimmed;
}

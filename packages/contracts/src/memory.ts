export const MEMORY_ADD_TOOL_NAME = "neo_memory_add";
export const MEMORY_SEARCH_TOOL_NAME = "neo_memory_search";

export const MEMORY_LIST_LIMIT_DEFAULT = 50;
export const MEMORY_LIST_LIMIT_MAX = 100;
export const MEMORY_SEARCH_LIMIT_DEFAULT = 8;
export const MEMORY_SEARCH_LIMIT_MAX = 32;
export const MEMORY_RECALL_LIMIT = 8;
export const MEMORY_PINNED_LIMIT = 12;
export const MEMORY_RELEVANT_LIMIT = 12;
export const MEMORY_SEARCH_FETCH = 24;
export const MEMORY_SCORE_MIN = 0.35;
export const MEMORY_SOFT_RELEVANT_LIMIT = 6;
export const MEMORY_SOFT_KIND_LIMIT = 2;
export const MEMORY_SNIPPET_LENGTH = 72;
export const MEMORY_TEXT_MAX_LENGTH = 500;
export const MEMORY_SEARCH_DEBOUNCE_MS = 300;
export const USER_RULES_MAX_LENGTH = 4000;
export const MEMORY_FILE = "MEMORY.md";
export const USER_RULES_FILE = "USER.md";
export const SESSION_MEMORY_FILE = "SESSION_MEMORY.md";
export const NEO_DIR = ".neo";

export const MEMORY_ACTION = { add: "add", search: "search", list: "list" } as const;
export type MemoryAction = (typeof MEMORY_ACTION)[keyof typeof MEMORY_ACTION];
export type MemorySource = "manual" | "agent";

export const MEMORY_KIND = { style: "style", habit: "habit", coding: "coding" } as const;
export type MemoryKind = (typeof MEMORY_KIND)[keyof typeof MEMORY_KIND];

export const MEMORY_STATUS = { candidate: "candidate", confirmed: "confirmed" } as const;
export type MemoryStatus = (typeof MEMORY_STATUS)[keyof typeof MEMORY_STATUS];

export const MEMORY_PROMOTE_TARGET = { user: "user", project: "project" } as const;
export type MemoryPromoteTarget = (typeof MEMORY_PROMOTE_TARGET)[keyof typeof MEMORY_PROMOTE_TARGET];

export const MEMORY_ERROR_CODE = {
  LOGIN_REQUIRED: "MEMORY_LOGIN_REQUIRED",
  TEXT_REQUIRED: "MEMORY_TEXT_REQUIRED",
  TEXT_TOO_LONG: "MEMORY_TEXT_TOO_LONG",
  QUERY_REQUIRED: "MEMORY_QUERY_REQUIRED",
  NOT_FOUND: "MEMORY_NOT_FOUND",
  VERSION_CONFLICT: "MEMORY_VERSION_CONFLICT",
  STORE_UNAVAILABLE: "MEMORY_STORE_UNAVAILABLE",
  STORE_FAILED: "MEMORY_STORE_FAILED",
  DISABLED: "MEMORY_DISABLED",
  RULES_TOO_LONG: "MEMORY_RULES_TOO_LONG",
  PROJECT_REQUIRED: "MEMORY_PROJECT_REQUIRED",
} as const;

export type MemoryErrorCode = (typeof MEMORY_ERROR_CODE)[keyof typeof MEMORY_ERROR_CODE];

const MEMORY_ERROR_MESSAGE: Record<MemoryErrorCode, string> = {
  MEMORY_LOGIN_REQUIRED: "请先登录",
  MEMORY_TEXT_REQUIRED: "请填写记忆内容",
  MEMORY_TEXT_TOO_LONG: "单条记忆不能超过 500 字",
  MEMORY_QUERY_REQUIRED: "请填写要搜索的内容",
  MEMORY_NOT_FOUND: "记忆不存在",
  MEMORY_VERSION_CONFLICT: "这条记忆刚被改过，请刷新后再试",
  MEMORY_STORE_UNAVAILABLE: "记忆还没接上",
  MEMORY_STORE_FAILED: "记忆服务暂时不可用",
  MEMORY_DISABLED: "记忆已关闭，这条不会写入",
  MEMORY_RULES_TOO_LONG: "用户规则不能超过 4000 字",
  MEMORY_PROJECT_REQUIRED: "提升到项目需要指定当前项目",
};

export type MemoryMetadata = {
  source?: MemorySource;
  status?: MemoryStatus;
  kind?: MemoryKind;
  pinned?: boolean;
  runId?: string;
};

export type MemoryItem = {
  id: string;
  text: string;
  score?: number;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: MemoryMetadata;
};

export type MemoryListResponse = {
  configured: boolean;
  memories: MemoryItem[];
};

export type MemorySettings = {
  enabled: boolean;
  userRules: string;
  configured: boolean;
};

export const MEMORY_INJECT_FILE_PREAMBLE =
  "These are tendencies recalled about this user. Use them to ask one fewer question. They are not veto power. The current task, repo, PROJECT.md, AGENTS.md, and test evidence win. Soft summaries (style / habit) can be ignored. Do not refuse a reasonable approach because memory prefers another.";

export const MEMORY_INJECT_SYSTEM_PREAMBLE = `Tendencies from the user's memory store. Use them to guess less, not to override the current task. Repo files, tests, PROJECT.md, AGENTS.md, and the current user message win if they conflict. Soft summaries can be ignored. Persist new facts with ${MEMORY_ADD_TOOL_NAME} and look them up with ${MEMORY_SEARCH_TOOL_NAME}.`;

export const USER_RULES_SYSTEM_PREAMBLE =
  "Hand-written rules from this user. Follow them carefully. They still lose to the current user message and to project instructions (PROJECT.md / AGENTS.md).";

export function memoryErrorMessage(code: MemoryErrorCode): string {
  return MEMORY_ERROR_MESSAGE[code];
}

/** Prefer `message`, then `error`. Empty when neither is a non-empty string. */
export function readMemoryError(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "";
  }
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error.trim();
  }
  return "";
}

/** True only when both timestamps parse and updated is later. */
export function memoryEdited(item: Pick<MemoryItem, "createdAt" | "updatedAt">): boolean {
  const created = Date.parse(item.createdAt ?? "");
  const updated = Date.parse(item.updatedAt ?? "");
  if (!Number.isFinite(created) || !Number.isFinite(updated)) {
    return false;
  }
  return updated > created;
}

export function memoryKindLabel(kind?: string): string {
  if (kind === "style") return "风格";
  if (kind === "habit") return "习惯";
  if (kind === "coding") return "工具";
  return "";
}

export function parseMemoryKind(value: unknown): MemoryKind | undefined {
  return value === "style" || value === "habit" || value === "coding" ? value : undefined;
}

export function parseMemoryStatus(value: unknown): MemoryStatus | undefined {
  return value === "candidate" || value === "confirmed" ? value : undefined;
}

export function parseMemorySource(value: unknown): MemorySource | undefined {
  return value === "manual" || value === "agent" ? value : undefined;
}

export function memoryKind(item: Pick<MemoryItem, "metadata">): MemoryKind | undefined {
  return parseMemoryKind(item.metadata?.kind);
}

export function isSoftMemoryKind(kind?: string): boolean {
  return kind === "style" || kind === "habit";
}

export function isPinnedMemory(item: Pick<MemoryItem, "metadata">): boolean {
  if (item.metadata?.pinned === true) {
    return true;
  }
  return item.metadata?.source === "manual" && item.metadata?.kind === "coding";
}

export function selectRecalledMemories(input: {
  candidates: MemoryItem[];
  pinned?: MemoryItem[];
}): { pinned: MemoryItem[]; relevant: MemoryItem[] } {
  const pinnedSeen = new Set<string>();
  const pinned: MemoryItem[] = [];
  for (const item of [...(input.pinned ?? []), ...input.candidates]) {
    if (!isPinnedMemory(item) || pinnedSeen.has(item.id) || pinned.length >= MEMORY_PINNED_LIMIT) {
      continue;
    }
    pinned.push(item);
    pinnedSeen.add(item.id);
  }
  const relevant: MemoryItem[] = [];
  const softCounts: Partial<Record<MemoryKind, number>> = {};
  let softTotal = 0;
  for (const item of input.candidates) {
    if (pinnedSeen.has(item.id)) {
      continue;
    }
    if (typeof item.score === "number" && item.score < MEMORY_SCORE_MIN) {
      continue;
    }
    const kind = memoryKind(item);
    if (isSoftMemoryKind(kind)) {
      if (softTotal >= MEMORY_SOFT_RELEVANT_LIMIT) {
        continue;
      }
      if ((softCounts[kind!] ?? 0) >= MEMORY_SOFT_KIND_LIMIT) {
        continue;
      }
      softCounts[kind!] = (softCounts[kind!] ?? 0) + 1;
      softTotal += 1;
    }
    relevant.push(item);
    if (relevant.length >= MEMORY_RELEVANT_LIMIT) {
      break;
    }
  }
  return { pinned, relevant };
}

export function formatUserMemory(items: Array<{ text: string }>): string {
  const lines = items.map((item) => item.text.trim()).filter(Boolean);
  if (lines.length === 0) {
    return "";
  }
  return ["# User memory", "", MEMORY_INJECT_FILE_PREAMBLE, "", ...lines.map((line) => `- ${line}`), ""].join("\n");
}

export function formatUserRules(rules: string): string {
  const text = rules.trim();
  if (!text) {
    return "";
  }
  return ["# User rules", "", USER_RULES_SYSTEM_PREAMBLE, "", text, ""].join("\n");
}

export function filterMemories<T extends { id: string; text: string }>(items: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.text.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle));
}

export function memoryHint(input: { configured: boolean; count: number; error?: string }): string {
  if (input.error) return input.error;
  if (!input.configured) return "记忆还没接上。接上后可以说「帮我记住」，也可以在这里看、改和删。";
  if (input.count === 0) return "还没有记忆。对话里让 Agent 记下，或点「记一条」。";
  return `已记住 ${input.count} 条。新对话会检索这些；不对的可以改或删。`;
}

export function appendUserMemory(systemPrompt: string, memory: string): string {
  const text = memory.trim();
  if (!text) {
    return systemPrompt;
  }
  return `${systemPrompt}\n\n# Recalled user memory\n${MEMORY_INJECT_SYSTEM_PREAMBLE}\n\n${text}`;
}

export function appendUserRules(systemPrompt: string, rules: string): string {
  const text = rules.trim();
  if (!text) {
    return systemPrompt;
  }
  return `${systemPrompt}\n\n# User rules\n${USER_RULES_SYSTEM_PREAMBLE}\n\n${text}`;
}

export function appendSessionMemoryLine(existing: string, text: string): string {
  const line = text.trim();
  if (!line) {
    return existing;
  }
  const body = existing.trim();
  const header = "# Session memory";
  const next = `${body && !body.startsWith("#") ? `${header}\n\n${body}` : body || header}\n- ${line}\n`;
  return next.startsWith(header) ? next : `${header}\n\n${next}`;
}

export function sessionMemoryLines(existing: string): string[] {
  return existing
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function wrapPromptWithSessionMemory(text: string, sessionMemory: string): string {
  const lines = sessionMemoryLines(sessionMemory);
  if (lines.length === 0) {
    return text;
  }
  return [`【本场已确认的事实】`, ...lines.map((line) => `- ${line}`), "", "【用户继续】", text].join("\n");
}

const BANNED_LOCK_RE = /必须|从不|永远|讨厌|must always|never always|always must|user hates/i;
const COMPANION_RE = /家人|父母|爸爸|妈妈|父亲|母亲|情绪|孤独|健康|财务|男友|女友|性取向|心情/;
const PROJECT_FACT_RE =
  /idle\s*槽|那个模块|本仓|这个\s*repo|这个仓库|这个项目|本场决策|架构决定|写回工作区|project instruction/i;

export function rejectExtractedMemoryText(text: string): string | null {
  const value = text.trim();
  if (!value) {
    return "empty";
  }
  if (BANNED_LOCK_RE.test(value)) {
    return "lock_phrase";
  }
  if (COMPANION_RE.test(value)) {
    return "companion";
  }
  if (PROJECT_FACT_RE.test(value)) {
    return "project_fact";
  }
  return null;
}

export function parseExtractedMemories(raw: string): Array<{ text: string; kind: MemoryKind }> {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("[");
  const jsonEnd = trimmed.lastIndexOf("]");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const items: Array<{ text: string; kind: MemoryKind }> = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as { text?: unknown; kind?: unknown };
      const text = typeof record.text === "string" ? record.text.trim() : "";
      const kind = parseMemoryKind(record.kind);
      if (!text || !kind || rejectExtractedMemoryText(text)) {
        continue;
      }
      items.push({ text: text.slice(0, MEMORY_TEXT_MAX_LENGTH), kind });
    }
    return items;
  } catch {
    return [];
  }
}

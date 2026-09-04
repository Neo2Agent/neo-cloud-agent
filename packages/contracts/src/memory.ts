export const MEMORY_ADD_TOOL_NAME = "neo_memory_add";
export const MEMORY_SEARCH_TOOL_NAME = "neo_memory_search";

export const MEMORY_LIST_LIMIT_DEFAULT = 50;
export const MEMORY_LIST_LIMIT_MAX = 100;
export const MEMORY_SEARCH_LIMIT_DEFAULT = 8;
export const MEMORY_SEARCH_LIMIT_MAX = 32;
export const MEMORY_RECALL_LIMIT = 8;
export const MEMORY_SNIPPET_LENGTH = 72;
export const MEMORY_TEXT_MAX_LENGTH = 500;
export const MEMORY_SEARCH_DEBOUNCE_MS = 300;
export const MEMORY_FILE = "MEMORY.md";
export const NEO_DIR = ".neo";

export const MEMORY_ACTION = { add: "add", search: "search", list: "list" } as const;
export type MemoryAction = (typeof MEMORY_ACTION)[keyof typeof MEMORY_ACTION];
export type MemorySource = "manual" | "agent";

export const MEMORY_ERROR_CODE = {
  LOGIN_REQUIRED: "MEMORY_LOGIN_REQUIRED",
  TEXT_REQUIRED: "MEMORY_TEXT_REQUIRED",
  TEXT_TOO_LONG: "MEMORY_TEXT_TOO_LONG",
  QUERY_REQUIRED: "MEMORY_QUERY_REQUIRED",
  NOT_FOUND: "MEMORY_NOT_FOUND",
  VERSION_CONFLICT: "MEMORY_VERSION_CONFLICT",
  STORE_UNAVAILABLE: "MEMORY_STORE_UNAVAILABLE",
  STORE_FAILED: "MEMORY_STORE_FAILED",
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
};

export type MemoryMetadata = { source?: MemorySource; runId?: string };

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

export function formatUserMemory(items: Array<{ text: string }>): string {
  const lines = items.map((item) => item.text.trim()).filter(Boolean);
  if (lines.length === 0) {
    return "";
  }
  return [
    "# User memory",
    "",
    "These are facts recalled about this user. Follow them unless the current message says otherwise.",
    "",
    ...lines.map((line) => `- ${line}`),
    "",
  ].join("\n");
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
  return `${systemPrompt}\n\n# Recalled user memory\nFacts from the user's memory store. Prefer them over guessing. The current user message wins if they conflict. There is no automatic extraction at the end of a conversation; persist new facts with ${MEMORY_ADD_TOOL_NAME} and look them up with ${MEMORY_SEARCH_TOOL_NAME}.\n\n${text}`;
}

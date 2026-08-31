export type MemoryItem = {
  id: string;
  text: string;
  score?: number;
  userId?: string;
  metadata?: Record<string, unknown>;
};

export type MemoryListResponse = {
  configured: boolean;
  memories: MemoryItem[];
};

export const MEMORY_ADD_TOOL_NAME = "neo_memory_add";
export const MEMORY_SEARCH_TOOL_NAME = "neo_memory_search";

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

export function appendUserMemory(systemPrompt: string, memory: string): string {
  const text = memory.trim();
  if (!text) {
    return systemPrompt;
  }
  return `${systemPrompt}\n\n# Recalled user memory\nFacts from the user's memory store. Prefer them over guessing. The current user message wins if they conflict. There is no automatic extraction at the end of a conversation; persist new facts with ${MEMORY_ADD_TOOL_NAME} and look them up with ${MEMORY_SEARCH_TOOL_NAME}.\n\n${text}`;
}

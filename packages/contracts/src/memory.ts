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

export function filterMemories<T extends { id: string; text: string }>(items: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.text.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle));
}

export function memoryHint(input: { configured: boolean; count: number; error?: string }): string {
  if (input.error) return input.error;
  if (!input.configured) return "记忆还没接上。接上后可以说「帮我记住」，也可以在这里看和删。";
  if (input.count === 0) return "还没有记忆。对话里让 Agent 记下，或点「记一条」。";
  return `已记住 ${input.count} 条。新对话会检索这些；不对的可以删。`;
}

export function appendUserMemory(systemPrompt: string, memory: string): string {
  const text = memory.trim();
  if (!text) {
    return systemPrompt;
  }
  return `${systemPrompt}\n\n# Recalled user memory\nFacts from the user's memory store. Prefer them over guessing. The current user message wins if they conflict. There is no automatic extraction at the end of a conversation; persist new facts with ${MEMORY_ADD_TOOL_NAME} and look them up with ${MEMORY_SEARCH_TOOL_NAME}.\n\n${text}`;
}

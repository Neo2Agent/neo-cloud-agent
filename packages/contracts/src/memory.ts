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
  return `${systemPrompt}\n\n# Recalled user memory\nFacts from previous conversations. Prefer them over guessing. The current user message wins if they conflict.\n\n${text}`;
}

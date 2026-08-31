export type MemoryRow = {
  id: string;
  text: string;
};

export function filterMemories<T extends MemoryRow>(items: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.text.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle));
}

export function memoryHint(input: { configured: boolean; count: number; error?: string }): string {
  if (input.error) return input.error;
  if (!input.configured) return "记忆还没接上。接上后可以说「帮我记住」，也可以在这里看和删。";
  if (input.count === 0) return "还没有记忆。对话里让 Agent 记下，或在上面写一条。";
  return `已记住 ${input.count} 条。新对话会检索这些；不对的可以删。`;
}

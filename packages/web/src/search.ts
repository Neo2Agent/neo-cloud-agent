import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";

export function searchTranscript(messages: TranscriptMessage[], query: string): TranscriptMessage[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return messages.filter((item) => {
    const hay = [item.text, item.kind, ...(item.tools ?? []).map((tool) => tool.name)].join("\n").toLowerCase();
    return hay.includes(needle);
  });
}

export function userQuestions(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.filter((item) => item.role === "user" && item.text.trim());
}

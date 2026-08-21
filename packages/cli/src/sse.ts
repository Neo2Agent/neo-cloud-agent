import type { RunEvent } from "@neo-cloud-agent/contracts";

export interface SseFrame {
  id?: string;
  data?: string;
}

export function parseSseChunk(buffer: string): { frames: SseFrame[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const frames: SseFrame[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed.startsWith(":")) {
      continue;
    }
    const frame: SseFrame = {};
    for (const line of part.split("\n")) {
      if (line.startsWith("id:")) {
        frame.id = line.slice(3).trim();
      } else if (line.startsWith("data:")) {
        frame.data = line.slice(5).trimStart();
      }
    }
    if (frame.data) {
      frames.push(frame);
    }
  }
  return { frames, rest };
}

export async function* readSseEvents(response: Response): AsyncGenerator<RunEvent> {
  if (!response.body) {
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        yield JSON.parse(frame.data ?? "{}") as RunEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

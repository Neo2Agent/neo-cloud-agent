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

export function parseSseData<T extends { id?: string; kind?: string }>(raw: string): T | null {
  try {
    const event = JSON.parse(raw) as T;
    return event?.id && event.kind ? event : null;
  } catch {
    return null;
  }
}

export function consumeSseBuffer<T extends { id?: string; kind?: string }>(buffer: string): {
  events: T[];
  rest: string;
} {
  const parsed = parseSseChunk(buffer);
  const events: T[] = [];
  for (const frame of parsed.frames) {
    const event = parseSseData<T>(frame.data ?? "");
    if (event) events.push(event);
  }
  return { events, rest: parsed.rest };
}

export function shouldUseXhrSse(): boolean {
  return typeof navigator !== "undefined" && navigator.product === "ReactNative";
}

export function streamSseWithXhr<T extends { id?: string; kind?: string }>(
  url: string,
  headers: Record<string, string>,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let buffer = "";
    let seen = 0;
    const flush = () => {
      const chunk = xhr.responseText.slice(seen);
      if (!chunk) return;
      seen = xhr.responseText.length;
      buffer += chunk;
      const parsed = consumeSseBuffer<T>(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        onEvent(event);
      }
    };
    const onAbort = () => {
      xhr.abort();
    };
    xhr.open("GET", url);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.onprogress = flush;
    xhr.onload = () => {
      flush();
      signal?.removeEventListener("abort", onAbort);
      if (xhr.status >= 400) {
        reject(new Error(`sse ${xhr.status}`));
        return;
      }
      resolve();
    };
    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("sse network"));
    };
    xhr.onabort = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    if (signal?.aborted) {
      resolve();
      return;
    }
    signal?.addEventListener("abort", onAbort);
    xhr.send();
  });
}

export async function* readSseEvents<T extends { id?: string; kind?: string }>(
  response: Response,
): AsyncGenerator<T> {
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
        const event = parseSseData<T>(frame.data ?? "");
        if (event) {
          yield event;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

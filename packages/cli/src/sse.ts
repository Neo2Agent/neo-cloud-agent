import http from "node:http";
import https from "node:https";
import type { RunEvent } from "@neo-cloud-agent/contracts";
import { CliError, EXIT_ERROR, EXIT_NETWORK, EXIT_USAGE } from "./errors.js";

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

/** Node http.get — fetch() + undici can stall on same-process event-stream bodies. */
export function streamSse(
  url: string,
  headers: Record<string, string>,
  onEvent: (event: RunEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(
      parsed,
      {
        method: "GET",
        headers: { accept: "text/event-stream", ...headers },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 400) {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let message = response.statusMessage ?? `http ${status}`;
            try {
              message = (JSON.parse(text) as { error?: string }).error ?? message;
            } catch {
              // keep status text
            }
            reject(new CliError(message, status === 401 ? EXIT_USAGE : EXIT_ERROR, status));
          });
          return;
        }
        let buffer = "";
        response.on("data", (chunk) => {
          buffer += String(chunk);
          const parsedChunk = parseSseChunk(buffer);
          buffer = parsedChunk.rest;
          for (const frame of parsedChunk.frames) {
            onEvent(JSON.parse(frame.data ?? "{}") as RunEvent);
          }
        });
        response.on("end", () => resolve());
        response.on("error", reject);
      },
    );
    req.on("error", (error) => {
      reject(new CliError(`cannot reach ${parsed.origin}: ${error.message}`, EXIT_NETWORK));
    });
    const abort = () => {
      req.destroy();
      resolve();
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    req.end();
  });
}

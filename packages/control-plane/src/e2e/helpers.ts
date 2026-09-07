import { spawnSync } from "node:child_process";
import http from "node:http";
import type { Server } from "node:http";

export function listen(server: Server, host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no listen port"));
        return;
      }
      resolve(address.port);
    });
    server.on("error", reject);
  });
}

export function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export async function archiveRun(base: string, runId: string): Promise<void> {
  try {
    await fetch(`${base}/v1/runs/${runId}/archive`, { method: "POST" });
  } catch {
    // control plane may already be gone
  }
}

export function dockerAvailable(): boolean {
  try {
    if (spawnSync("docker", ["info"], { encoding: "utf8", timeout: 4000 }).status === 0) {
      return true;
    }
    return spawnSync("sudo", ["-n", "docker", "info"], { encoding: "utf8", timeout: 4000 }).status === 0;
  } catch {
    return false;
  }
}

export function dockerImageExists(image: string): boolean {
  const args = ["image", "inspect", image];
  const direct = spawnSync("docker", args, { encoding: "utf8" });
  if (direct.status === 0) {
    return true;
  }
  return spawnSync("sudo", ["-n", "docker", ...args], { encoding: "utf8" }).status === 0;
}

export type RunEventLite = { id?: string; kind: string; data?: Record<string, unknown> };

export async function fetchRunTranscript(base: string, runId: string): Promise<{
  events: RunEventLite[];
  messages: Array<{ role: string; text: string; streaming?: boolean }>;
}> {
  const transcript = (await (await fetch(`${base}/v1/runs/${runId}/transcript?includeEvents=1`)).json()) as {
    events?: RunEventLite[];
    snapshot?: { messages?: Array<{ role: string; text: string; streaming?: boolean }> };
  };
  return {
    events: transcript.events ?? [],
    messages: transcript.snapshot?.messages ?? [],
  };
}

export async function waitForRun(
  base: string,
  runId: string,
  timeoutMs: number,
  opts: { minAgentEnds?: number } = {},
): Promise<{ kinds: string[]; status: string; errorMessage: string | null }> {
  const deadline = Date.now() + timeoutMs;
  const minAgentEnds = opts.minAgentEnds ?? 1;
  let kinds: string[] = [];
  let status = "RUNNING";
  let errorMessage: string | null = null;
  while (Date.now() < deadline) {
    const transcript = await fetchRunTranscript(base, runId);
    kinds = transcript.events.map((item) => item.kind);
    const latest = (await (await fetch(`${base}/v1/runs/${runId}`)).json()) as {
      status: string;
      errorMessage: string | null;
    };
    status = latest.status;
    errorMessage = latest.errorMessage;
    const ends = kinds.filter((kind) => kind === "agent.end").length;
    if (status === "ERROR" || ends >= minAgentEnds) {
      return { kinds, status, errorMessage };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { kinds, status, errorMessage };
}

export function attachSse(base: string, runId: string): {
  events: RunEventLite[];
  close(): void;
} {
  const events: RunEventLite[] = [];
  let buffer = "";
  const url = new URL(`/v1/runs/${runId}/events`, base);
  const request = http.get(url, { headers: { accept: "text/event-stream" } }, (response) => {
    response.on("data", (chunk) => {
      buffer += String(chunk);
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((item) => item.startsWith("data: "));
        if (!line) {
          continue;
        }
        try {
          events.push(JSON.parse(line.slice(6)) as RunEventLite);
        } catch {
          // ignore malformed SSE frames
        }
      }
    });
  });
  request.on("error", () => {
    // closed by test teardown
  });
  return {
    events,
    close() {
      request.destroy();
    },
  };
}

export async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  message = "timed out",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

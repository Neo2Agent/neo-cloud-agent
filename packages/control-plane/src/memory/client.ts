import type { MemoryItem, MemoryMetadata } from "@neo-cloud-agent/contracts";

const DEFAULT_TIMEOUT_MS = 4000;

export type Mem0PublicInfo = {
  configured: boolean;
};

export class Mem0Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let mem0Fetch: FetchLike = globalThis.fetch;

export function setMem0FetchForTests(fn: FetchLike | null): void {
  mem0Fetch = fn ?? globalThis.fetch;
}

export function readMem0Info(env: NodeJS.ProcessEnv = process.env): Mem0PublicInfo {
  const url = (env.MEM0_URL ?? "").trim().replace(/\/$/, "") || null;
  const key = (env.MEM0_API_KEY ?? "").trim();
  return { configured: Boolean(url && key) };
}

function mem0Config(env: NodeJS.ProcessEnv = process.env): { url: string; key: string } | null {
  const url = (env.MEM0_URL ?? "").trim().replace(/\/$/, "") || null;
  const key = (env.MEM0_API_KEY ?? "").trim();
  if (!url || !key) {
    return null;
  }
  return { url, key };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function itemText(raw: Record<string, unknown>): string {
  for (const key of ["memory", "text", "data"] as const) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readMetadata(raw: unknown): MemoryMetadata | undefined {
  const meta = asRecord(raw);
  if (!meta) {
    return undefined;
  }
  const source = meta.source === "manual" || meta.source === "agent" ? meta.source : undefined;
  const runId = typeof meta.runId === "string" ? meta.runId : undefined;
  if (!source && !runId) {
    return undefined;
  }
  return { ...(source ? { source } : {}), ...(runId ? { runId } : {}) };
}

function readTimestamp(raw: Record<string, unknown>, snake: string, camel: string): string | undefined {
  const value = raw[snake] ?? raw[camel];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function normalizeMemoryResults(body: unknown): MemoryItem[] {
  if (!body) {
    return [];
  }
  const record = asRecord(body);
  const list = Array.isArray(body)
    ? body
    : Array.isArray(record?.results)
      ? record.results
      : Array.isArray(record?.memories)
        ? record.memories
        : Array.isArray(record?.data)
          ? record.data
          : [];
  const items: MemoryItem[] = [];
  for (const entry of list) {
    const raw = asRecord(entry);
    if (!raw) {
      continue;
    }
    const id = typeof raw.id === "string" ? raw.id : typeof raw.memory_id === "string" ? raw.memory_id : "";
    const text = itemText(raw);
    if (!id || !text) {
      continue;
    }
    const item: MemoryItem = { id, text };
    if (typeof raw.score === "number") {
      item.score = raw.score;
    }
    if (typeof raw.user_id === "string") {
      item.userId = raw.user_id;
    }
    const createdAt = readTimestamp(raw, "created_at", "createdAt");
    if (createdAt) {
      item.createdAt = createdAt;
    }
    const updatedAt = readTimestamp(raw, "updated_at", "updatedAt");
    if (updatedAt) {
      item.updatedAt = updatedAt;
    }
    const metadata = readMetadata(raw.metadata);
    if (metadata) {
      item.metadata = metadata;
    }
    items.push(item);
  }
  return items;
}

async function mem0Request(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const config = mem0Config();
  if (!config) {
    throw new Mem0Error("mem0_not_configured", 503);
  }
  const headers: Record<string, string> = { "X-API-Key": config.key };
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await mem0Fetch(`${config.url}${path}`, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "mem0_unreachable";
    throw new Mem0Error(message, 502, { cause: error });
  }
  const raw = await response.text();
  let parsed: unknown = raw;
  if (raw) {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = { raw: raw.slice(0, 200) };
    }
  }
  if (!response.ok) {
    throw new Mem0Error(`mem0_${response.status}`, response.status);
  }
  return parsed;
}

export async function listMemories(userId: string, limit: number): Promise<MemoryItem[]> {
  const parsed = await mem0Request(
    "GET",
    `/memories?user_id=${encodeURIComponent(userId)}&limit=${limit}`,
  );
  return normalizeMemoryResults(parsed);
}

export async function addMemory(input: {
  userId: string;
  text: string;
  infer?: boolean;
  metadata?: MemoryMetadata;
}): Promise<MemoryItem[]> {
  const parsed = await mem0Request("POST", "/memories", {
    user_id: input.userId,
    text: input.text,
    infer: input.infer ?? false,
    metadata: input.metadata,
  });
  return normalizeMemoryResults(parsed);
}

export async function searchMemories(input: {
  userId: string;
  query: string;
  limit: number;
}): Promise<MemoryItem[]> {
  const parsed = await mem0Request("POST", "/search", {
    query: input.query,
    user_id: input.userId,
    limit: input.limit,
  });
  return normalizeMemoryResults(parsed);
}

export async function updateMemory(input: {
  id: string;
  userId: string;
  text: string;
  updatedAt?: string;
}): Promise<MemoryItem> {
  const parsed = await mem0Request("PUT", `/memories/${encodeURIComponent(input.id)}`, {
    user_id: input.userId,
    text: input.text,
    ...(input.updatedAt ? { updated_at: input.updatedAt } : {}),
  });
  const items = normalizeMemoryResults(parsed);
  const item = items[0];
  if (!item) {
    throw new Mem0Error("mem0_empty_update", 502);
  }
  return item;
}

export async function deleteMemory(id: string, userId: string): Promise<void> {
  await mem0Request("DELETE", `/memories/${encodeURIComponent(id)}?user_id=${encodeURIComponent(userId)}`);
}

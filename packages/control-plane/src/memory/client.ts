import type { MemoryItem } from "@neo-cloud-agent/contracts";

const DEFAULT_TIMEOUT_MS = 4000;

export type Mem0PublicInfo = {
  configured: boolean;
  url: string | null;
};

export class Mem0Error extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
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
  return { configured: Boolean(url && key), url };
}

function mem0Config(env: NodeJS.ProcessEnv = process.env): { url: string; key: string } | null {
  const info = readMem0Info(env);
  const key = (env.MEM0_API_KEY ?? "").trim();
  if (!info.configured || !info.url || !key) {
    return null;
  }
  return { url: info.url, key };
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

function normalizeMemoryItem(raw: Record<string, unknown>): MemoryItem | null {
  const id = typeof raw.id === "string" ? raw.id : typeof raw.memory_id === "string" ? raw.memory_id : "";
  const text = itemText(raw);
  if (!id || !text) {
    return null;
  }
  const item: MemoryItem = { id, text };
  if (typeof raw.score === "number") {
    item.score = raw.score;
  }
  if (typeof raw.user_id === "string") {
    item.userId = raw.user_id;
  }
  if (asRecord(raw.metadata)) {
    item.metadata = asRecord(raw.metadata) ?? undefined;
  }
  return item;
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
    const item = normalizeMemoryItem(raw);
    if (item) {
      items.push(item);
    }
  }
  if (items.length === 0 && record) {
    const single = normalizeMemoryItem(record);
    if (single) {
      return [single];
    }
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
    throw new Mem0Error(message, 502);
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

export async function listMemories(userId: string, limit = 50): Promise<MemoryItem[]> {
  const parsed = await mem0Request(
    "GET",
    `/memories?user_id=${encodeURIComponent(userId)}&limit=${Math.min(100, Math.max(1, limit))}`,
  );
  return normalizeMemoryResults(parsed);
}

export async function addMemory(input: {
  userId: string;
  text: string;
  infer?: boolean;
  metadata?: Record<string, unknown>;
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
  limit?: number;
}): Promise<MemoryItem[]> {
  const parsed = await mem0Request("POST", "/search", {
    query: input.query,
    user_id: input.userId,
    limit: input.limit ?? 8,
  });
  return normalizeMemoryResults(parsed);
}

export async function getMemory(id: string): Promise<MemoryItem | null> {
  const parsed = await mem0Request("GET", `/memories/${encodeURIComponent(id)}`);
  return normalizeMemoryResults(parsed)[0] ?? null;
}

export async function requireOwnedMemory(userId: string, id: string): Promise<MemoryItem> {
  const owned = (await listMemories(userId, 100)).find((item) => item.id === id);
  if (owned) {
    return owned;
  }
  try {
    const one = await getMemory(id);
    if (one && (!one.userId || one.userId === userId)) {
      return one;
    }
  } catch (error) {
    if (!(error instanceof Mem0Error) || error.status !== 404) {
      throw error;
    }
  }
  throw new Mem0Error("memory_not_found", 404);
}

export async function updateMemory(input: { id: string; userId: string; text: string }): Promise<MemoryItem> {
  const text = input.text.trim();
  if (!text) {
    throw new Mem0Error("text is required", 400);
  }
  await requireOwnedMemory(input.userId, input.id);
  const parsed = await mem0Request("PUT", `/memories/${encodeURIComponent(input.id)}`, {
    text,
    user_id: input.userId,
  });
  return normalizeMemoryResults(parsed)[0] ?? { id: input.id, text, userId: input.userId };
}

export async function deleteMemory(id: string): Promise<void> {
  await mem0Request("DELETE", `/memories/${encodeURIComponent(id)}`);
}

export async function deleteOwnedMemory(userId: string, id: string): Promise<void> {
  await requireOwnedMemory(userId, id);
  await deleteMemory(id);
}

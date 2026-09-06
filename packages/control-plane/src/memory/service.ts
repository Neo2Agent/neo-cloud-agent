import {
  MEMORY_ERROR_CODE,
  MEMORY_LIST_LIMIT_DEFAULT,
  MEMORY_LIST_LIMIT_MAX,
  MEMORY_SEARCH_LIMIT_DEFAULT,
  MEMORY_SEARCH_LIMIT_MAX,
  MEMORY_TEXT_MAX_LENGTH,
  memoryErrorMessage,
  type MemoryErrorCode,
  type MemoryItem,
  type MemoryMetadata,
} from "@neo-cloud-agent/contracts";
import { getUserMemorySettings } from "../accounts/accounts.js";
import {
  addMemory,
  deleteMemory,
  listMemories,
  Mem0Error,
  searchMemories,
  updateMemory,
} from "./client.js";
import { applyMemoryFlags, deleteMemoryFlags, mergeMemoryFlags } from "./flags.js";

export class MemoryServiceError extends Error {
  constructor(
    readonly code: MemoryErrorCode,
    readonly status: number,
    readonly userTip: string,
    readonly detail?: string,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

/**
 * Display-only limit. Illegal / empty values fall back; out-of-range values clamp.
 */
export function normalizeLimit(
  raw: string | number | null | undefined,
  fallback: number,
  max: number,
): number {
  if (raw === null || raw === undefined || raw === "") {
    return fallback;
  }
  const value = Math.trunc(Number(raw));
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.min(max, value);
}

function requireText(raw: string | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) {
    throw new MemoryServiceError(
      MEMORY_ERROR_CODE.TEXT_REQUIRED,
      400,
      memoryErrorMessage(MEMORY_ERROR_CODE.TEXT_REQUIRED),
    );
  }
  if (text.length > MEMORY_TEXT_MAX_LENGTH) {
    throw new MemoryServiceError(
      MEMORY_ERROR_CODE.TEXT_TOO_LONG,
      400,
      memoryErrorMessage(MEMORY_ERROR_CODE.TEXT_TOO_LONG),
    );
  }
  return text;
}

function requireQuery(raw: string | undefined): string {
  const query = (raw ?? "").trim();
  if (!query) {
    throw new MemoryServiceError(
      MEMORY_ERROR_CODE.QUERY_REQUIRED,
      400,
      memoryErrorMessage(MEMORY_ERROR_CODE.QUERY_REQUIRED),
    );
  }
  return query;
}

function mapStoreError(error: unknown): MemoryServiceError {
  if (error instanceof MemoryServiceError) {
    return error;
  }
  if (error instanceof Mem0Error) {
    if (error.status === 404) {
      return new MemoryServiceError(
        MEMORY_ERROR_CODE.NOT_FOUND,
        404,
        memoryErrorMessage(MEMORY_ERROR_CODE.NOT_FOUND),
        undefined,
        { cause: error },
      );
    }
    if (error.status === 409) {
      return new MemoryServiceError(
        MEMORY_ERROR_CODE.VERSION_CONFLICT,
        409,
        memoryErrorMessage(MEMORY_ERROR_CODE.VERSION_CONFLICT),
        undefined,
        { cause: error },
      );
    }
    if (error.status === 503) {
      return new MemoryServiceError(
        MEMORY_ERROR_CODE.STORE_UNAVAILABLE,
        503,
        memoryErrorMessage(MEMORY_ERROR_CODE.STORE_UNAVAILABLE),
        error.message,
        { cause: error },
      );
    }
    return new MemoryServiceError(
      MEMORY_ERROR_CODE.STORE_FAILED,
      502,
      memoryErrorMessage(MEMORY_ERROR_CODE.STORE_FAILED),
      error.message,
      { cause: error },
    );
  }
  const detail = error instanceof Error ? error.message : undefined;
  return new MemoryServiceError(
    MEMORY_ERROR_CODE.STORE_FAILED,
    502,
    memoryErrorMessage(MEMORY_ERROR_CODE.STORE_FAILED),
    detail,
    { cause: error },
  );
}

async function callStore<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw mapStoreError(error);
  }
}

export async function assertMemoryEnabled(userId: string): Promise<void> {
  const settings = await getUserMemorySettings(userId);
  if (!settings.enabled) {
    throw new MemoryServiceError(
      MEMORY_ERROR_CODE.DISABLED,
      403,
      memoryErrorMessage(MEMORY_ERROR_CODE.DISABLED),
    );
  }
}

export async function listUserMemories(userId: string, limitRaw?: string | number): Promise<MemoryItem[]> {
  const limit = normalizeLimit(limitRaw, MEMORY_LIST_LIMIT_DEFAULT, MEMORY_LIST_LIMIT_MAX);
  const items = await callStore(() => listMemories(userId, limit));
  return applyMemoryFlags(userId, items);
}

export async function addUserMemory(
  userId: string,
  text: string,
  metadata?: MemoryMetadata,
): Promise<MemoryItem[]> {
  await assertMemoryEnabled(userId);
  const value = requireText(text);
  const items = await callStore(() => addMemory({ userId, text: value, infer: false, metadata }));
  const flagged = applyMemoryFlags(userId, items);
  if (metadata && flagged[0]) {
    mergeMemoryFlags(userId, flagged[0].id, {
      kind: metadata.kind,
      status: metadata.status,
      pinned: metadata.pinned,
    });
    return applyMemoryFlags(userId, flagged);
  }
  return flagged;
}

export async function searchUserMemories(
  userId: string,
  query: string,
  limitRaw?: string | number,
): Promise<MemoryItem[]> {
  const value = requireQuery(query);
  const limit = normalizeLimit(limitRaw, MEMORY_SEARCH_LIMIT_DEFAULT, MEMORY_SEARCH_LIMIT_MAX);
  const items = await callStore(() => searchMemories({ userId, query: value, limit }));
  return applyMemoryFlags(userId, items);
}

export async function updateUserMemory(input: {
  userId: string;
  id: string;
  text: string;
  updatedAt?: string;
}): Promise<MemoryItem> {
  const text = requireText(input.text);
  return callStore(() =>
    updateMemory({
      id: input.id,
      userId: input.userId,
      text,
      updatedAt: input.updatedAt,
    }),
  );
}

export async function removeUserMemory(userId: string, id: string): Promise<void> {
  await callStore(() => deleteMemory(id, userId));
  deleteMemoryFlags(userId, id);
}

export async function findUserMemory(userId: string, id: string): Promise<MemoryItem> {
  const items = await listUserMemories(userId);
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new MemoryServiceError(
      MEMORY_ERROR_CODE.NOT_FOUND,
      404,
      memoryErrorMessage(MEMORY_ERROR_CODE.NOT_FOUND),
    );
  }
  return item;
}

export async function pinUserMemory(userId: string, id: string, pinned: boolean): Promise<MemoryItem> {
  const item = await findUserMemory(userId, id);
  mergeMemoryFlags(userId, id, { pinned, status: "confirmed" });
  try {
    await updateMemory({
      id,
      userId,
      text: item.text,
      metadata: { ...item.metadata, pinned, status: "confirmed" },
    });
  } catch {
    // Overlay is authoritative if the sidecar cannot store metadata yet.
  }
  return findUserMemory(userId, id);
}

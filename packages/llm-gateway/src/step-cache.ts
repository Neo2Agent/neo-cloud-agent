const TTL_MS = 10 * 60_000;

export type CachedStep = {
  status: number;
  headers: Record<string, string>;
  payload: string;
  expiresAt: number;
};

const cache = new Map<string, CachedStep>();

export function normalizeStepId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) {
    return undefined;
  }
  return trimmed;
}

export function rememberSuccessfulStep(
  stepId: string | undefined,
  result: { status: number; headers: Record<string, string>; stream: boolean; payload: string | ReadableStream<Uint8Array> },
): void {
  const id = normalizeStepId(stepId);
  if (!id || result.stream || result.status >= 400 || typeof result.payload !== "string") {
    return;
  }
  cache.set(id, {
    status: result.status,
    headers: result.headers,
    payload: result.payload,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function replaySuccessfulStep(stepId: string | undefined): CachedStep | undefined {
  const id = normalizeStepId(stepId);
  if (!id) {
    return undefined;
  }
  const hit = cache.get(id);
  if (!hit) {
    return undefined;
  }
  if (hit.expiresAt <= Date.now()) {
    cache.delete(id);
    return undefined;
  }
  return hit;
}

export function clearStepCache(): void {
  cache.clear();
}

import { getConfig } from "../config.js";

const CACHE_MS = 5_000;

let cache: { ok: boolean; checkedAt: number } | null = null;

export async function isNeoLoopAvailable(url = getConfig().neoLoopUrl): Promise<boolean> {
  if (cache && Date.now() - cache.checkedAt < CACHE_MS) {
    return cache.ok;
  }
  if (process.env.NODE_TEST_CONTEXT && process.env.NEO_LOOP_PROBE !== "1") {
    cache = { ok: false, checkedAt: Date.now() };
    return false;
  }
  const base = url.replace(/\/$/, "");
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(400) });
    cache = { ok: response.ok, checkedAt: Date.now() };
  } catch {
    cache = { ok: false, checkedAt: Date.now() };
  }
  return cache.ok;
}

export function peekNeoLoopAvailable(): boolean | null {
  return cache?.ok ?? null;
}

export function resetNeoLoopHealthForTest(): void {
  cache = null;
}

export function setNeoLoopHealthForTest(ok: boolean): void {
  cache = { ok, checkedAt: Date.now() };
}

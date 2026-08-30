import type { RedisHotClient } from "../events/redis.js";

export type RateLimitPolicyName =
  | "ip"
  | "login"
  | "login_account"
  | "webhook"
  | "api"
  | "write"
  | "create_run"
  | "follow_up"
  | "expensive"
  | "speech"
  | "sse"
  | "llm_run"
  | "llm_org"
  | "llm_inflight_run"
  | "llm_inflight_org";

export type RateLimitKind = "token" | "concurrency";

export type RateLimitSpec = {
  limit: number;
  windowMs: number;
  burst: number;
  kind: RateLimitKind;
};

export type RateLimitDecision = {
  ok: boolean;
  policy: RateLimitPolicyName;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
};

export type ConcurrencyLease = RateLimitDecision & {
  release: () => void;
};

export type RateLimitStoreKind = "memory" | "redis";

type TokenBucket = {
  tokens: number;
  updatedAt: number;
};

const DEFAULTS: Record<RateLimitPolicyName, RateLimitSpec> = {
  ip: { limit: 240, windowMs: 60_000, burst: 240, kind: "token" },
  login: { limit: 20, windowMs: 15 * 60_000, burst: 5, kind: "token" },
  login_account: { limit: 8, windowMs: 15 * 60_000, burst: 3, kind: "token" },
  webhook: { limit: 120, windowMs: 60_000, burst: 40, kind: "token" },
  api: { limit: 180, windowMs: 60_000, burst: 40, kind: "token" },
  write: { limit: 60, windowMs: 60_000, burst: 15, kind: "token" },
  create_run: { limit: 12, windowMs: 60_000, burst: 4, kind: "token" },
  follow_up: { limit: 30, windowMs: 60_000, burst: 10, kind: "token" },
  expensive: { limit: 10, windowMs: 60_000, burst: 3, kind: "token" },
  speech: { limit: 3600, windowMs: 60_000, burst: 80, kind: "token" },
  sse: { limit: 6, windowMs: 0, burst: 6, kind: "concurrency" },
  llm_run: { limit: 90, windowMs: 60_000, burst: 20, kind: "token" },
  llm_org: { limit: 180, windowMs: 60_000, burst: 40, kind: "token" },
  llm_inflight_run: { limit: 3, windowMs: 0, burst: 3, kind: "concurrency" },
  llm_inflight_org: { limit: 12, windowMs: 0, burst: 12, kind: "concurrency" },
};

const ENV_LIMIT: Record<RateLimitPolicyName, string> = {
  ip: "RATE_LIMIT_IP",
  login: "RATE_LIMIT_LOGIN",
  login_account: "RATE_LIMIT_LOGIN_ACCOUNT",
  webhook: "RATE_LIMIT_WEBHOOK",
  api: "RATE_LIMIT_API",
  write: "RATE_LIMIT_WRITE",
  create_run: "RATE_LIMIT_CREATE_RUN",
  follow_up: "RATE_LIMIT_FOLLOW_UP",
  expensive: "RATE_LIMIT_EXPENSIVE",
  speech: "RATE_LIMIT_SPEECH",
  sse: "RATE_LIMIT_SSE",
  llm_run: "RATE_LIMIT_LLM_RUN",
  llm_org: "RATE_LIMIT_LLM_ORG",
  llm_inflight_run: "RATE_LIMIT_LLM_INFLIGHT_RUN",
  llm_inflight_org: "RATE_LIMIT_LLM_INFLIGHT_ORG",
};

const buckets = new Map<string, TokenBucket>();
const inflight = new Map<string, number>();
let redisStore: RedisHotClient | null = null;

export const RATE_LIMIT_POLICIES = Object.keys(DEFAULTS) as RateLimitPolicyName[];

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export function rateLimitEnabled(): boolean {
  const raw = (process.env.RATE_LIMIT ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") {
    return false;
  }
  if (raw === "1" || raw === "true" || raw === "on") {
    return true;
  }
  return !process.env.NODE_TEST_CONTEXT;
}

export function rateLimitTrustProxy(): boolean {
  const raw = (process.env.RATE_LIMIT_TRUST_PROXY ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function attachRateLimitRedis(client: RedisHotClient | null): void {
  redisStore = client;
}

export function rateLimitStoreKind(): RateLimitStoreKind {
  return redisStore ? "redis" : "memory";
}

export function resetRateLimitStore(): void {
  buckets.clear();
  inflight.clear();
}

export function readRateLimitSpec(policy: RateLimitPolicyName): RateLimitSpec {
  const fallback = DEFAULTS[policy];
  const limit = envInt(ENV_LIMIT[policy], fallback.limit);
  const windowMs = envInt(`${ENV_LIMIT[policy]}_WINDOW_MS`, fallback.windowMs);
  const burst = envInt(`${ENV_LIMIT[policy]}_BURST`, fallback.burst);
  return {
    limit: Number.isFinite(limit) ? limit : fallback.limit,
    windowMs: windowMs > 0 ? windowMs : fallback.windowMs,
    burst: burst > 0 ? burst : Math.max(1, limit || fallback.burst),
    kind: fallback.kind,
  };
}

export function readRateLimitConfig(): Record<RateLimitPolicyName, RateLimitSpec> {
  const out = {} as Record<RateLimitPolicyName, RateLimitSpec>;
  for (const policy of RATE_LIMIT_POLICIES) {
    out[policy] = readRateLimitSpec(policy);
  }
  return out;
}

function storeKey(policy: RateLimitPolicyName, key: string): string {
  return `${policy}:${key}`;
}

function allowedDecision(policy: RateLimitPolicyName, spec: RateLimitSpec, remaining: number, now: number): RateLimitDecision {
  return {
    ok: true,
    policy,
    limit: spec.limit,
    remaining: Math.max(0, remaining),
    resetAt: now + Math.max(spec.windowMs, 0),
    retryAfterMs: 0,
  };
}

function unlimitedDecision(policy: RateLimitPolicyName, now: number): RateLimitDecision {
  return { ok: true, policy, limit: 0, remaining: Number.MAX_SAFE_INTEGER, resetAt: now, retryAfterMs: 0 };
}

function deniedDecision(
  policy: RateLimitPolicyName,
  spec: RateLimitSpec,
  retryAfterMs: number,
  now: number,
): RateLimitDecision {
  const wait = Math.max(1, retryAfterMs);
  return {
    ok: false,
    policy,
    limit: spec.limit,
    remaining: 0,
    resetAt: now + wait,
    retryAfterMs: wait,
  };
}

function consumeMemoryBucket(mapKey: string, spec: RateLimitSpec, now: number): { ok: boolean; remaining: number; retryAfterMs: number } {
  const refillPerMs = spec.limit > 0 && spec.windowMs > 0 ? spec.limit / spec.windowMs : 0;
  const burst = Math.max(1, spec.burst);
  const current = buckets.get(mapKey) ?? { tokens: burst, updatedAt: now };
  const elapsed = Math.max(0, now - current.updatedAt);
  const tokens = refillPerMs > 0 ? Math.min(burst, current.tokens + elapsed * refillPerMs) : burst;
  if (tokens >= 1) {
    const next = tokens - 1;
    buckets.set(mapKey, { tokens: next, updatedAt: now });
    return { ok: true, remaining: Math.floor(next), retryAfterMs: 0 };
  }
  const retryAfterMs = refillPerMs > 0 ? Math.ceil((1 - tokens) / refillPerMs) : spec.windowMs || 1000;
  buckets.set(mapKey, { tokens, updatedAt: now });
  return { ok: false, remaining: 0, retryAfterMs };
}

function peekMemoryBucket(mapKey: string, spec: RateLimitSpec, now: number): { remaining: number; resetAt: number } {
  const refillPerMs = spec.limit > 0 && spec.windowMs > 0 ? spec.limit / spec.windowMs : 0;
  const burst = Math.max(1, spec.burst);
  const current = buckets.get(mapKey);
  if (!current) {
    return { remaining: burst, resetAt: now + spec.windowMs };
  }
  const tokens = refillPerMs > 0 ? Math.min(burst, current.tokens + Math.max(0, now - current.updatedAt) * refillPerMs) : burst;
  const missing = Math.max(0, burst - tokens);
  const resetAt = refillPerMs > 0 && missing > 0 ? now + Math.ceil(missing / refillPerMs) : now + spec.windowMs;
  return { remaining: Math.floor(tokens), resetAt };
}

async function consumeRedisWindow(
  policy: RateLimitPolicyName,
  key: string,
  spec: RateLimitSpec,
  now: number,
): Promise<RateLimitDecision | null> {
  const redis = redisStore;
  if (!redis) {
    return null;
  }
  const windowMs = Math.max(1, spec.windowMs);
  const windowId = Math.floor(now / windowMs);
  const redisKey = `neo:rl:${policy}:${key}:${windowId}`;
  try {
    const count = await redis.incrWithTtl(redisKey, windowMs + 1_000);
    const remaining = Math.max(0, spec.limit - count);
    const resetAt = (windowId + 1) * windowMs;
    if (count > spec.limit) {
      return deniedDecision(policy, spec, resetAt - now, now);
    }
    return { ok: true, policy, limit: spec.limit, remaining, resetAt, retryAfterMs: 0 };
  } catch (error) {
    console.error("rate-limit redis consume failed", error);
    return null;
  }
}

async function peekRedisWindow(
  policy: RateLimitPolicyName,
  key: string,
  spec: RateLimitSpec,
  now: number,
): Promise<{ remaining: number; resetAt: number } | null> {
  const redis = redisStore;
  if (!redis) {
    return null;
  }
  const windowMs = Math.max(1, spec.windowMs);
  const windowId = Math.floor(now / windowMs);
  const redisKey = `neo:rl:${policy}:${key}:${windowId}`;
  try {
    const raw = await redis.get(redisKey);
    const count = raw ? Number(raw) : 0;
    return {
      remaining: Math.max(0, spec.limit - (Number.isFinite(count) ? count : 0)),
      resetAt: (windowId + 1) * windowMs,
    };
  } catch {
    return null;
  }
}

export async function consumeRateLimit(
  policy: RateLimitPolicyName,
  key: string,
  options?: { now?: number; spec?: RateLimitSpec },
): Promise<RateLimitDecision> {
  const now = options?.now ?? Date.now();
  if (!rateLimitEnabled()) {
    return unlimitedDecision(policy, now);
  }
  const spec = options?.spec ?? readRateLimitSpec(policy);
  if (spec.limit <= 0 || spec.kind === "concurrency") {
    return unlimitedDecision(policy, now);
  }
  const redisDecision = await consumeRedisWindow(policy, key, spec, now);
  if (redisDecision) {
    return redisDecision;
  }
  const consumed = consumeMemoryBucket(storeKey(policy, key), spec, now);
  return consumed.ok
    ? allowedDecision(policy, spec, consumed.remaining, now)
    : deniedDecision(policy, spec, consumed.retryAfterMs, now);
}

export async function peekRateLimit(
  policy: RateLimitPolicyName,
  key: string,
  options?: { now?: number; spec?: RateLimitSpec },
): Promise<RateLimitDecision> {
  const now = options?.now ?? Date.now();
  const spec = options?.spec ?? readRateLimitSpec(policy);
  if (!rateLimitEnabled() || spec.limit <= 0) {
    return unlimitedDecision(policy, now);
  }
  if (spec.kind === "concurrency") {
    const current = inflight.get(storeKey(policy, key)) ?? 0;
    const remaining = Math.max(0, spec.limit - current);
    return {
      ok: remaining > 0,
      policy,
      limit: spec.limit,
      remaining,
      resetAt: now,
      retryAfterMs: remaining > 0 ? 0 : 1_000,
    };
  }
  const redisPeek = await peekRedisWindow(policy, key, spec, now);
  if (redisPeek) {
    return {
      ok: redisPeek.remaining > 0,
      policy,
      limit: spec.limit,
      remaining: redisPeek.remaining,
      resetAt: redisPeek.resetAt,
      retryAfterMs: redisPeek.remaining > 0 ? 0 : Math.max(1, redisPeek.resetAt - now),
    };
  }
  const peeked = peekMemoryBucket(storeKey(policy, key), spec, now);
  return {
    ok: peeked.remaining > 0,
    policy,
    limit: spec.limit,
    remaining: peeked.remaining,
    resetAt: peeked.resetAt,
    retryAfterMs: peeked.remaining > 0 ? 0 : Math.max(1, peeked.resetAt - now),
  };
}

export async function acquireConcurrency(
  policy: RateLimitPolicyName,
  key: string,
  options?: { spec?: RateLimitSpec },
): Promise<ConcurrencyLease> {
  const now = Date.now();
  const spec = options?.spec ?? readRateLimitSpec(policy);
  const noop = (): void => undefined;
  if (!rateLimitEnabled() || spec.limit <= 0) {
    return { ...unlimitedDecision(policy, now), release: noop };
  }
  const mapKey = storeKey(policy, key);
  const current = inflight.get(mapKey) ?? 0;
  if (current >= spec.limit) {
    return { ...deniedDecision(policy, spec, 1_000, now), release: noop };
  }
  inflight.set(mapKey, current + 1);
  let released = false;
  return {
    ...allowedDecision(policy, spec, spec.limit - current - 1, now),
    release() {
      if (released) {
        return;
      }
      released = true;
      const next = (inflight.get(mapKey) ?? 1) - 1;
      if (next <= 0) {
        inflight.delete(mapKey);
      } else {
        inflight.set(mapKey, next);
      }
    },
  };
}

export function isRateLimitExempt(method: string, path: string): boolean {
  if (method === "OPTIONS") {
    return true;
  }
  if (path === "/health") {
    return true;
  }
  if (path.startsWith("/internal/")) {
    return true;
  }
  if (path === "/oauth/callback/mcp") {
    return true;
  }
  return !path.startsWith("/v1/") && !path.startsWith("/webhooks/");
}

export function publicRateLimitPolicies(method: string, path: string): RateLimitPolicyName[] {
  if (isRateLimitExempt(method, path)) {
    return [];
  }
  if (method === "POST" && path === "/v1/speech/iat") {
    return [];
  }
  const out: RateLimitPolicyName[] = ["ip"];
  if (path.startsWith("/webhooks/")) {
    out.push("webhook");
  }
  if (
    method === "POST" &&
    (path === "/v1/auth/login" || path === "/v1/auth" || path === "/v1/auth/register" || path === "/v1/auth/bootstrap")
  ) {
    out.push("login");
  }
  return out;
}

export function isExpensiveWrite(method: string, path: string): boolean {
  if (method !== "POST" && method !== "DELETE" && method !== "PATCH") {
    return false;
  }
  if (path.startsWith("/v1/settings/")) {
    return true;
  }
  if (path === "/v1/builds" || path === "/v1/environments") {
    return true;
  }
  if (/^\/v1\/environments\/[^/]+\/builds$/.test(path)) {
    return true;
  }
  if (/^\/v1\/runs\/[^/]+\/(commit|pull-request|scm\/pull-request|handoff|transfer)$/.test(path)) {
    return true;
  }
  if (path === "/v1/desks" || ((method === "DELETE" || method === "PATCH") && /^\/v1\/desks\/[^/]+$/.test(path))) {
    return true;
  }
  if (path === "/v1/automations" || /^\/v1\/automations\/[^/]+/.test(path)) {
    return true;
  }
  if (path === "/v1/projects" || /^\/v1\/projects\/[^/]+/.test(path)) {
    return true;
  }
  return false;
}

export function actorRateLimitPolicies(method: string, path: string): RateLimitPolicyName[] {
  if (!path.startsWith("/v1/") || path.startsWith("/v1/auth")) {
    return [];
  }
  if (method === "POST" && path === "/v1/speech/iat") {
    return ["speech"];
  }
  const out: RateLimitPolicyName[] = ["api"];
  if (method === "POST" || method === "DELETE" || method === "PUT" || method === "PATCH") {
    out.push("write");
  }
  if (method === "POST" && path === "/v1/runs") {
    out.push("create_run");
  }
  if (method === "POST" && /^\/v1\/runs\/[^/]+\/follow-ups$/.test(path)) {
    out.push("follow_up");
  }
  if (isExpensiveWrite(method, path)) {
    out.push("expensive");
  }
  return out;
}

export function isSsePath(method: string, path: string): boolean {
  return method === "GET" && /^\/v1\/runs\/[^/]+\/events$/.test(path);
}

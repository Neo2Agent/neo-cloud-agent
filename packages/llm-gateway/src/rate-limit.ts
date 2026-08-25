export type GatewayRateLimitPolicy = "llm_run" | "llm_org" | "llm_inflight_run" | "llm_inflight_org";

export type GatewayRateLimitDecision = {
  ok: boolean;
  policy: GatewayRateLimitPolicy;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
};

export type GatewayConcurrencyLease = GatewayRateLimitDecision & {
  release: () => void;
};

type TokenBucket = { tokens: number; updatedAt: number };
type PolicySpec = { limit: number; windowMs: number; burst: number };

const buckets = new Map<string, TokenBucket>();
const inflight = new Map<string, number>();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export function gatewayRateLimitEnabled(): boolean {
  const raw = (process.env.RATE_LIMIT ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") {
    return false;
  }
  if (raw === "1" || raw === "true" || raw === "on") {
    return true;
  }
  return !process.env.NODE_TEST_CONTEXT;
}

export function resetGatewayRateLimitStore(): void {
  buckets.clear();
  inflight.clear();
}

export function readGatewayRateLimitSpec(policy: GatewayRateLimitPolicy): PolicySpec {
  if (policy === "llm_run") {
    return {
      limit: envInt("RATE_LIMIT_LLM_RUN", 90),
      windowMs: envInt("RATE_LIMIT_LLM_RUN_WINDOW_MS", 60_000),
      burst: envInt("RATE_LIMIT_LLM_RUN_BURST", 20),
    };
  }
  if (policy === "llm_org") {
    return {
      limit: envInt("RATE_LIMIT_LLM_ORG", 180),
      windowMs: envInt("RATE_LIMIT_LLM_ORG_WINDOW_MS", 60_000),
      burst: envInt("RATE_LIMIT_LLM_ORG_BURST", 40),
    };
  }
  if (policy === "llm_inflight_run") {
    return { limit: envInt("RATE_LIMIT_LLM_INFLIGHT_RUN", 3), windowMs: 0, burst: 3 };
  }
  return { limit: envInt("RATE_LIMIT_LLM_INFLIGHT_ORG", 12), windowMs: 0, burst: 12 };
}

function unlimited(policy: GatewayRateLimitPolicy, now: number): GatewayRateLimitDecision {
  return { ok: true, policy, limit: 0, remaining: Number.MAX_SAFE_INTEGER, resetAt: now, retryAfterMs: 0 };
}

function consumeBucket(mapKey: string, spec: PolicySpec, now: number): { ok: boolean; remaining: number; retryAfterMs: number } {
  const refillPerMs = spec.limit > 0 && spec.windowMs > 0 ? spec.limit / spec.windowMs : 0;
  const burst = Math.max(1, spec.burst);
  const current = buckets.get(mapKey) ?? { tokens: burst, updatedAt: now };
  const tokens = refillPerMs > 0 ? Math.min(burst, current.tokens + Math.max(0, now - current.updatedAt) * refillPerMs) : burst;
  if (tokens >= 1) {
    const next = tokens - 1;
    buckets.set(mapKey, { tokens: next, updatedAt: now });
    return { ok: true, remaining: Math.floor(next), retryAfterMs: 0 };
  }
  const retryAfterMs = refillPerMs > 0 ? Math.ceil((1 - tokens) / refillPerMs) : spec.windowMs || 1000;
  buckets.set(mapKey, { tokens, updatedAt: now });
  return { ok: false, remaining: 0, retryAfterMs };
}

export function consumeGatewayRateLimit(policy: GatewayRateLimitPolicy, key: string): GatewayRateLimitDecision {
  const now = Date.now();
  if (!gatewayRateLimitEnabled()) {
    return unlimited(policy, now);
  }
  const spec = readGatewayRateLimitSpec(policy);
  if (spec.limit <= 0) {
    return unlimited(policy, now);
  }
  const consumed = consumeBucket(`${policy}:${key}`, spec, now);
  if (consumed.ok) {
    return {
      ok: true,
      policy,
      limit: spec.limit,
      remaining: consumed.remaining,
      resetAt: now + spec.windowMs,
      retryAfterMs: 0,
    };
  }
  const wait = Math.max(1, consumed.retryAfterMs);
  return { ok: false, policy, limit: spec.limit, remaining: 0, resetAt: now + wait, retryAfterMs: wait };
}

export function acquireGatewayConcurrency(policy: "llm_inflight_run" | "llm_inflight_org", key: string): GatewayConcurrencyLease {
  const now = Date.now();
  const spec = readGatewayRateLimitSpec(policy);
  const noop = (): void => undefined;
  if (!gatewayRateLimitEnabled() || spec.limit <= 0) {
    return { ...unlimited(policy, now), release: noop };
  }
  const mapKey = `${policy}:${key}`;
  const current = inflight.get(mapKey) ?? 0;
  if (current >= spec.limit) {
    return {
      ok: false,
      policy,
      limit: spec.limit,
      remaining: 0,
      resetAt: now + 1_000,
      retryAfterMs: 1_000,
      release: noop,
    };
  }
  inflight.set(mapKey, current + 1);
  let released = false;
  return {
    ok: true,
    policy,
    limit: spec.limit,
    remaining: spec.limit - current - 1,
    resetAt: now,
    retryAfterMs: 0,
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

export function gatewayRateLimitHeaders(decision: GatewayRateLimitDecision): Record<string, string> {
  return {
    "retry-after": String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))),
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": String(Math.ceil(decision.resetAt / 1000)),
    "x-ratelimit-policy": decision.policy,
  };
}

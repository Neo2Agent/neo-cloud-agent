import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeEmail } from "../accounts/types.js";
import type { Actor } from "./actor.js";
import {
  acquireConcurrency,
  actorRateLimitPolicies,
  consumeRateLimit,
  isRateLimitExempt,
  isSsePath,
  peekRateLimit,
  publicRateLimitPolicies,
  rateLimitEnabled,
  rateLimitStoreKind,
  rateLimitTrustProxy,
  readRateLimitConfig,
  type ConcurrencyLease,
  type RateLimitDecision,
  type RateLimitPolicyName,
} from "./rate-limit.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Last-Event-ID, Content-Type, Authorization",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers":
    "Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Policy",
} as const;

function headerValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function clientIp(req: IncomingMessage): string {
  if (rateLimitTrustProxy()) {
    const forwarded = headerValue(req.headers["x-forwarded-for"]);
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) {
        return normalizeIp(first);
      }
    }
    const real = headerValue(req.headers["x-real-ip"]);
    if (real) {
      return normalizeIp(real);
    }
  }
  return normalizeIp(req.socket.remoteAddress ?? "unknown");
}

export function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed.startsWith("::ffff:")) {
    return trimmed.slice("::ffff:".length);
  }
  return trimmed || "unknown";
}

export function actorRateLimitKey(actor: Actor | null | undefined, ip: string): string {
  if (!actor) {
    return `ip:${ip}`;
  }
  if (actor.kind === "user") {
    return `user:${actor.userId}`;
  }
  if (actor.kind === "service") {
    return `service:${actor.orgId}`;
  }
  return `anon:${actor.userId}:${ip}`;
}

export function orgRateLimitKey(actor: Actor | null | undefined, ip: string): string {
  return actor ? `org:${actor.orgId}` : `ip:${ip}`;
}

export function loginAccountKey(email: string | undefined, ip: string): string {
  const normalized = normalizeEmail(email ?? "");
  return normalized || `ip:${ip}`;
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "retry-after": String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))),
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": String(Math.ceil(decision.resetAt / 1000)),
    "x-ratelimit-policy": decision.policy,
  };
}

export function sendRateLimited(res: ServerResponse, decision: RateLimitDecision): void {
  const body = JSON.stringify({
    error: "rate_limited",
    policy: decision.policy,
    retryAfterMs: decision.retryAfterMs,
    limit: decision.limit,
  });
  res.writeHead(429, {
    ...CORS,
    ...rateLimitHeaders(decision),
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export async function rejectRateLimits(
  res: ServerResponse,
  checks: Array<{ policy: RateLimitPolicyName; key: string }>,
): Promise<boolean> {
  if (!rateLimitEnabled()) {
    return false;
  }
  for (const check of checks) {
    const decision = await consumeRateLimit(check.policy, check.key);
    if (!decision.ok) {
      sendRateLimited(res, decision);
      return true;
    }
  }
  return false;
}

export async function rejectPublicRateLimits(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
): Promise<boolean> {
  if (isRateLimitExempt(method, path)) {
    return false;
  }
  const ip = clientIp(req);
  return rejectRateLimits(
    res,
    publicRateLimitPolicies(method, path).map((policy) => ({ policy, key: ip })),
  );
}

export async function rejectActorRateLimits(
  req: IncomingMessage,
  res: ServerResponse,
  actor: Actor | null,
  method: string,
  path: string,
): Promise<boolean> {
  const ip = clientIp(req);
  const userKey = actorRateLimitKey(actor, ip);
  const orgKey = orgRateLimitKey(actor, ip);
  const checks = actorRateLimitPolicies(method, path).map((policy) => ({
    policy,
    key: policy === "create_run" ? orgKey : userKey,
  }));
  return rejectRateLimits(res, checks);
}

export async function acquireSseLease(
  req: IncomingMessage,
  actor: Actor | null,
): Promise<ConcurrencyLease> {
  return acquireConcurrency("sse", actorRateLimitKey(actor, clientIp(req)));
}

export function shouldLimitSse(method: string, path: string): boolean {
  return isSsePath(method, path);
}

export async function rateLimitSnapshot(actor: Actor | null, ip: string) {
  const config = readRateLimitConfig();
  const userKey = actorRateLimitKey(actor, ip);
  const orgKey = orgRateLimitKey(actor, ip);
  const policies: Record<string, RateLimitDecision & { windowMs: number; burst: number; kind: string }> = {};
  const keys: Record<RateLimitPolicyName, string> = {
    ip,
    login: ip,
    login_account: ip,
    webhook: ip,
    api: userKey,
    write: userKey,
    create_run: orgKey,
    follow_up: userKey,
    expensive: userKey,
    speech: userKey,
    sse: userKey,
    llm_run: orgKey,
    llm_org: orgKey,
    llm_inflight_run: orgKey,
    llm_inflight_org: orgKey,
  };
  for (const [policy, spec] of Object.entries(config)) {
    const name = policy as RateLimitPolicyName;
    const peeked = await peekRateLimit(name, keys[name], { spec });
    policies[name] = { ...peeked, windowMs: spec.windowMs, burst: spec.burst, kind: spec.kind };
  }
  return {
    enabled: rateLimitEnabled(),
    store: rateLimitStoreKind(),
    trustProxy: rateLimitTrustProxy(),
    policies,
  };
}

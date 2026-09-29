export type LeasePollKind = "ok" | "auth" | "limited" | "down";

const LIMITED = /rate_limited/i;
const AUTH = /unauthorized|login_required|desk not found/i;

/** A lease heartbeat is not a user-facing failure when production is just busy. */
export function classifyLeaseFailure(message: string): Exclude<LeasePollKind, "ok"> {
  if (AUTH.test(message)) return "auth";
  if (LIMITED.test(message)) return "limited";
  return "down";
}

/**
 * Text for the composer toast. Rate limits stay quiet: the poll backs off
 * instead of parking `rate_limited` under the input for the whole turn.
 */
export function leaseUserError(message: string): string | null {
  if (classifyLeaseFailure(message) === "limited") return null;
  return `本机保活失败：${message}`;
}

/** Gap before the next lease poll. Limited polls wait long enough for the bucket to refill. */
export function leaseRetryDelayMs(kind: LeasePollKind, failures: number): number {
  if (kind === "ok") return 1_000;
  const base = kind === "limited" ? 15_000 : 2_000;
  const steps = Math.min(Math.max(failures, 1), 4);
  return Math.min(60_000, base * 2 ** (steps - 1));
}

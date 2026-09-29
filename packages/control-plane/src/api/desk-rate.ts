import type { RateLimitPolicyName } from "../security/rate-limit.js";

/**
 * Which buckets a desk action spends.
 *
 * `lease` is the machine's long-poll heartbeat. Counting it as a write shares
 * the 60/min write bucket with claim, release, and git snapshots, so a live
 * This Computer turn returns `rate_limited` and Desk paints that under the composer.
 */
export function deskActionRatePolicies(action: string): RateLimitPolicyName[] {
  if (action === "lease") return ["api"];
  return ["api", "write"];
}

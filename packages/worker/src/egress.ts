import {
  evaluateEgress,
  mergeEgressPolicy,
  type EgressDecision,
  type EgressMode,
  type EgressPolicy,
} from "@neo-cloud-agent/contracts";

function parseMode(raw: string | undefined): EgressMode {
  if (raw === "default_plus_allowlist" || raw === "allowlist_only" || raw === "allow_all") {
    return raw;
  }
  return "allow_all";
}

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env, file?: EgressPolicy): EgressPolicy {
  if (file?.mode) {
    return mergeEgressPolicy(file);
  }
  return mergeEgressPolicy({
    mode: parseMode(env.NEO_EGRESS_MODE),
    domains: (env.NEO_EGRESS_DOMAINS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  });
}

export function installEgressGuard(
  policy: EgressPolicy,
  onDenied?: (decision: EgressDecision) => void,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const decision = evaluateEgress(policy, url);
    if (!decision.allow) {
      onDenied?.(decision);
      return Promise.reject(new Error(decision.reason));
    }
    return original(input, init);
  };
  return () => {
    globalThis.fetch = original;
  };
}

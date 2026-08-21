import assert from "node:assert/strict";
import test from "node:test";
import { installEgressGuard, policyFromEnv } from "./egress.js";

test("worker fetch guard blocks hosts outside the allowlist", async () => {
  const policy = policyFromEnv({
    NEO_EGRESS_MODE: "allowlist_only",
    NEO_EGRESS_DOMAINS: "pkgs.example",
  });
  const restore = installEgressGuard(policy);
  try {
    await assert.rejects(() => fetch("https://evil.example/secret"), /blocked evil.example/);
  } finally {
    restore();
  }
});

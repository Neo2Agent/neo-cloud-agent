import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveEgressPolicy } from "./resolve.js";

test("workspace environment.json egress wins over the saved environment", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-egress-"));
  mkdirSync(path.join(dir, ".neo"), { recursive: true });
  writeFileSync(
    path.join(dir, ".neo/environment.json"),
    JSON.stringify({ egress: { mode: "allowlist_only", domains: ["pkgs.example"] } }),
  );
  const policy = resolveEgressPolicy({
    workspaceDir: dir,
    env: { config: { egress: { mode: "allow_all" } } },
    controlPlaneUrl: "http://cp.internal:8080",
    llmGatewayUrl: "http://gw.internal:8081",
  });
  assert.equal(policy.mode, "allowlist_only");
  assert.ok(policy.domains?.includes("pkgs.example"));
  assert.ok(policy.domains?.includes("cp.internal"));
  assert.ok(policy.domains?.includes("gw.internal"));
});

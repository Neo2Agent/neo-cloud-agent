import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { findInstallTargets, installEnv, runInstallCommand } from "./install.js";
import { parseEnvironmentJson } from "./store.js";

test("parseEnvironmentJson keeps install/start and drops unknown fields", () => {
  const config = parseEnvironmentJson({
    install: "echo hi",
    start: "pnpm dev",
    extra: true,
    terminals: [{ name: "web", command: "pnpm dev" }, { name: 1 }],
    egress: { mode: "allow_all", domains: ["example.com", 3] },
  });
  assert.equal(config.install, "echo hi");
  assert.equal(config.start, "pnpm dev");
  assert.deepEqual(config.terminals, [{ name: "web", command: "pnpm dev" }]);
  assert.deepEqual(config.egress, { mode: "allow_all", domains: ["example.com"] });
  assert.equal("extra" in config, false);
});

test("findInstallTargets prefers repo-root .neo/environment.json", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-env-"));
  mkdirSync(path.join(dir, ".neo"), { recursive: true });
  writeFileSync(
    path.join(dir, ".neo/environment.json"),
    JSON.stringify({ install: "printf ok > installed.txt", start: "printf no > started.txt" }),
  );
  const targets = findInstallTargets(dir);
  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.command, "printf ok > installed.txt");
  assert.equal(targets[0]?.config.start, "printf no > started.txt");
});

test("runInstallCommand executes install and does not run start", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-install-"));
  const result = await runInstallCommand(dir, "printf 'ok\\n' > installed.txt");
  assert.equal(result.code, 0);
  assert.equal(readFileSync(path.join(dir, "installed.txt"), "utf8").trim(), "ok");
});

test("installEnv strips provider and git secrets", () => {
  const env = installEnv({
    PATH: "/bin",
    DEEPSEEK_API_KEY: "sk-secret",
    OPENAI_API_KEY: "sk-openai",
    LLM_GATEWAY_JWT_SECRET: "jwt",
    GITHUB_TOKEN: "gh",
    HOME: "/tmp",
  });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.HOME, "/tmp");
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.LLM_GATEWAY_JWT_SECRET, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
});

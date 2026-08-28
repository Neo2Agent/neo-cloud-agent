import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CLOUD_SYSTEM_PROMPT, CLOUD_TOOL_NAMES, createPiCloudTools, sessionToolNames } from "./cloud-tools.js";
import { gatewayModelSpec, supportsVision } from "./model-spec.js";
import { readExpertWorkspace } from "./expert-workspace.js";

test("session tools include filesystem tools plus neo-git, neo-pr, and neo-diag", () => {
  assert.deepEqual(sessionToolNames(), [
    "read",
    "write",
    "edit",
    "bash",
    "grep",
    "find",
    "ls",
    ...CLOUD_TOOL_NAMES,
  ]);
  assert.match(CLOUD_SYSTEM_PROMPT, /neo_git_commit/);
  assert.match(CLOUD_SYSTEM_PROMPT, /neo_pr_open/);
  assert.match(CLOUD_SYSTEM_PROMPT, /neo_diag/);
  assert.match(CLOUD_SYSTEM_PROMPT, /neo_artifact_upload/);
  assert.match(CLOUD_SYSTEM_PROMPT, /neo_browse/);
  assert.match(CLOUD_SYSTEM_PROMPT, /neo_mcp_list/);
  assert.match(CLOUD_SYSTEM_PROMPT, /neo_subagent/);
  assert.match(CLOUD_SYSTEM_PROMPT, /neo_subscribe/);
  assert.match(CLOUD_SYSTEM_PROMPT, /Do not `git commit`/);
  assert.deepEqual(sessionToolNames({ includeSubagent: false }).includes("neo_subagent"), false);
  assert.deepEqual(sessionToolNames({ includeSubagent: false }).includes("neo_subscribe"), false);
});

test("createPiCloudTools wraps extension execute into pi tool results", async () => {
  const tools = createPiCloudTools({
    runId: "run_wrap",
    controlPlaneUrl: "http://control.local",
    jwt: "jwt",
    workspaceDir: "/tmp",
    fetch: async () => new Response(JSON.stringify({ error: "missing message" }), { status: 400 }),
  });
  assert.deepEqual(
    tools.map((item) => item.name),
    [...CLOUD_TOOL_NAMES],
  );
  const commit = tools.find((item) => item.name === "neo_git_commit");
  assert.ok(commit);
  const result = await commit.execute("call-1", { message: "  " }, undefined, undefined, {} as never);
  assert.equal(result.content[0]?.type, "text");
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /required/i);
  const subagent = tools.find((item) => item.name === "neo_subagent");
  assert.ok(subagent);
  const delegated = await subagent.execute("call-2", { agent: "scout", task: "find auth" }, undefined, undefined, {} as never);
  const delegatedText = delegated.content[0]?.type === "text" ? delegated.content[0].text : "";
  assert.match(delegatedText, /worker session|scout/i);
});

test("gateway model spec uses each model's advertised window", () => {
  assert.equal(gatewayModelSpec("deepseek-v4-flash-vision-exp").contextWindow, 1_000_000);
  assert.equal(gatewayModelSpec("deepseek-v4-flash").contextWindow, 1_000_000);
  assert.equal(gatewayModelSpec("deepseek-v4-pro").contextWindow, 1_000_000);
  assert.equal(gatewayModelSpec("gpt-4o-mini").contextWindow, 128_000);
  assert.equal(gatewayModelSpec("mystery-local").contextWindow, 0);
  assert.equal(gatewayModelSpec("mystery-local").compactionEnabled, false);
  assert.notEqual(gatewayModelSpec("deepseek-v4-flash").contextWindow, gatewayModelSpec("gpt-4o-mini").contextWindow);
  assert.equal(supportsVision("deepseek-v4-flash"), false);
  assert.equal(supportsVision("deepseek-v4-flash-vision-exp"), true);
  assert.equal(supportsVision("gpt-4o-mini"), true);
  assert.equal(gatewayModelSpec("deepseek-v4-flash").maxTokens, 16_384);
  assert.ok(gatewayModelSpec("deepseek-v4-flash").maxTokens < 384_000);
});

test("readExpertWorkspace loads Role Override and tool allowlist", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "neo-expert-ws-"));
  mkdirSync(path.join(cwd, ".neo"), { recursive: true });
  writeFileSync(
    path.join(cwd, ".neo", "expert.json"),
    `${JSON.stringify({ id: "exp_reviewer", slug: "reviewer", name: "审查", kind: "expert", tools: ["read", "grep"] })}\n`,
  );
  writeFileSync(path.join(cwd, ".neo", "EXPERT.md"), "Role Override: You are the reviewer expert.\n");
  const expert = readExpertWorkspace(cwd);
  assert.match(expert.role, /Role Override/);
  assert.deepEqual(expert.tools, ["read", "grep"]);
});

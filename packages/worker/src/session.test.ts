import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_SYSTEM_PROMPT, CLOUD_TOOL_NAMES, createPiCloudTools, sessionToolNames } from "./cloud-tools.js";

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
  assert.match(CLOUD_SYSTEM_PROMPT, /Do not `git commit`/);
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
  assert.match(result.content[0]?.text ?? "", /required/i);
});

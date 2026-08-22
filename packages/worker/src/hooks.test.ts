import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  decideWorkspaceHooks,
  hookMatchesTool,
  loadWorkspaceHooks,
  parseHookOutput,
  parseHooksFile,
} from "./hooks.js";

test("parseHooksFile reads Cursor-style command hooks", () => {
  const hooks = parseHooksFile(
    JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [{ command: "./hooks/pre.sh", matcher: "Bash|Shell" }],
        beforeShellExecution: [{ type: "command", command: "./hooks/shell.sh" }],
        afterFileEdit: [{ command: "./hooks/edit.sh" }],
        stop: [{ command: "./hooks/stop.sh" }],
      },
    }),
  );
  assert.equal(hooks.length, 4);
  assert.equal(hooks[0]?.event, "preToolUse");
  assert.equal(hookMatchesTool("Bash|Shell", "bash"), true);
  assert.equal(hookMatchesTool("Write", "bash"), false);
  assert.equal(hookMatchesTool(undefined, "read"), true);
});

test("parseHookOutput accepts permission, decision, and continue fields", () => {
  assert.deepEqual(parseHookOutput('{"permission":"deny","user_message":"no"}'), {
    deny: true,
    reason: "no",
  });
  assert.deepEqual(parseHookOutput('{"decision":"block","reason":"stop"}'), {
    deny: true,
    reason: "stop",
  });
  assert.equal(parseHookOutput('{"continue":true}').deny, false);
  assert.equal(parseHookOutput("not json").deny, false);
});

test("loadWorkspaceHooks only reads workspace hook files", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-hooks-"));
  mkdirSync(path.join(root, ".cursor"), { recursive: true });
  writeFileSync(
    path.join(root, ".cursor/hooks.json"),
    JSON.stringify({
      hooks: {
        preToolUse: [{ command: "printf '{\"permission\":\"deny\",\"reason\":\"blocked bash\"}\\n'", matcher: "bash" }],
      },
    }),
  );
  writeFileSync(path.join(root, "hooks.json"), JSON.stringify({ hooks: { preToolUse: [{ command: "true" }] } }));
  const hooks = loadWorkspaceHooks(root);
  assert.equal(hooks.length, 1);
  const denied = await decideWorkspaceHooks(
    hooks,
    "preToolUse",
    "bash",
    { hook_event_name: "preToolUse", tool_name: "bash" },
    root,
  );
  assert.equal(denied.deny, true);
  assert.match(denied.reason ?? "", /blocked bash/);
  const allowed = await decideWorkspaceHooks(
    hooks,
    "preToolUse",
    "read",
    { hook_event_name: "preToolUse", tool_name: "read" },
    root,
  );
  assert.equal(allowed.deny, false);
});

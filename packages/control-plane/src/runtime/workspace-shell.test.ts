import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { colocatedTarget } from "@neo-cloud-agent/contracts";
import {
  closeWorkspaceTerm,
  listWorkspaceTerms,
  onWorkspaceTermEvent,
  MAX_TERMS_PER_RUN,
  openWorkspaceTerm,
  resetWorkspaceShellsForTests,
  workspaceShellLaunch,
  workspaceTermDeniedReason,
  workspaceTermEnv,
  writeWorkspaceTerm,
} from "./workspace-shell.js";

test("unix launch prefers a real interactive shell", () => {
  const launch = workspaceShellLaunch();
  assert.match(launch.command, /zsh|bash|sh/);
  assert.deepEqual(launch.args, ["-i"]);
});

test("desk runs are sent back to the local Desk terminal", () => {
  assert.equal(workspaceTermDeniedReason(colocatedTarget("cloud")), null);
  assert.match(workspaceTermDeniedReason(colocatedTarget("desk", "desk_1")) ?? "", /Desk/);
});

test("term env does not inherit control-plane secrets", () => {
  const env = workspaceTermEnv("/tmp/ws", "/bin/bash");
  assert.equal(env.HOME, "/tmp/ws");
  assert.equal(env.TERM, "dumb");
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.CONTROL_PLANE_TOKEN, undefined);
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
});

test("a piped workspace shell runs a written command", async (t) => {
  resetWorkspaceShellsForTests();
  t.after(() => resetWorkspaceShellsForTests());
  const cwd = mkdtempSync(path.join(tmpdir(), "neo-term-"));
  const opened = openWorkspaceTerm({ runId: "run_term", cwd });
  assert.equal(opened.alive, true);
  assert.equal(listWorkspaceTerms("run_term").length, 1);
  const chunks: string[] = [];
  const stop = onWorkspaceTermEvent(opened.id, (event) => {
    if (event.type === "data") {
      chunks.push(event.chunk);
    }
  });
  t.after(stop);
  writeWorkspaceTerm("run_term", opened.id, "printf 'hello-term\\n'\n");
  const deadline = Date.now() + 4_000;
  let text = chunks.join("");
  while (!text.includes("hello-term") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    text = chunks.join("");
  }
  assert.match(text, /hello-term/);
  assert.throws(
    () => writeWorkspaceTerm("someone-else", opened.id, "echo no\n"),
    (error: Error) => error.name === "WorkspaceTermError",
  );
  assert.equal(closeWorkspaceTerm("run_term", opened.id), true);
  assert.equal(listWorkspaceTerms("run_term").length, 0);
});

test("a run cannot open more than the session cap", (t) => {
  resetWorkspaceShellsForTests();
  t.after(() => resetWorkspaceShellsForTests());
  const cwd = mkdtempSync(path.join(tmpdir(), "neo-term-cap-"));
  for (let i = 0; i < MAX_TERMS_PER_RUN; i += 1) {
    openWorkspaceTerm({ runId: "run_cap", cwd });
  }
  assert.throws(
    () => openWorkspaceTerm({ runId: "run_cap", cwd }),
    (error: Error) => error.name === "WorkspaceTermError" && error.message.includes("最多"),
  );
});

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "test-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-orch-"));
delete process.env.WORKER_WORKSPACE_MOUNT;

const { createRun, getBootstrap, getRun, ingestEvents, listRuns, reloadPersistedState, takeInbound } =
  await import("./orchestrator.js");
const { listEvents } = await import("../events/bus.js");

test("createRun mints a bootstrap JWT, copies the local repo, and queues the first prompt", async () => {
  const run = await createRun({
    prompt: "list files",
    repoUrls: ["fixtures/toy-repo"],
  });
  assert.equal(run.status, "RUNNING");
  const bootstrap = getBootstrap(run.id);
  assert.ok(bootstrap.jwt.split(".").length === 3);
  assert.equal(bootstrap.run.id, run.id);
  assert.equal(readFileSync(path.join(bootstrap.workspaceDir, "hello.txt"), "utf8").includes("toy repo"), true);
  assert.equal(existsSync(path.join(bootstrap.workspaceDir, "test.sh")), true);
  assert.equal(readFileSync(path.join(bootstrap.workspaceDir, ".neo-installed"), "utf8").trim(), "ok");
  assert.equal(existsSync(path.join(bootstrap.workspaceDir, ".neo-started")), false);
  assert.equal(run.setupStatus, "INSTALL_SUCCEEDED");
  const inbox = takeInbound(run.id);
  const first = inbox[0];
  assert.ok(first);
  assert.equal(first.type, "prompt");
  assert.equal("text" in first ? first.text : "", "list files");
  const kinds = listEvents(run.id).map((item) => item.kind);
  assert.ok(kinds.includes("user.message"));
  assert.ok(kinds.includes("scm.clone_started"));
  assert.ok(kinds.includes("scm.clone_succeeded"));
  assert.ok(kinds.includes("run.install_started"));
  assert.ok(kinds.includes("run.install_succeeded"));
});

test("createRun fails when environment install exits non-zero", async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "neo-bad-install-"));
  mkdirSync(path.join(fixture, ".neo"), { recursive: true });
  writeFileSync(path.join(fixture, ".neo/environment.json"), JSON.stringify({ install: "exit 7" }));
  writeFileSync(path.join(fixture, "README.md"), "x\n");
  const run = await createRun({
    prompt: "install should fail",
    repoUrls: [fixture],
  });
  assert.equal(run.status, "ERROR");
  assert.equal(run.setupStatus, "INSTALL_FAILED");
  assert.ok(listEvents(run.id).some((item) => item.kind === "run.install_failed"));
});

test("persisted idle runs survive a control-plane reload", async () => {
  const run = await createRun({
    prompt: "keep this chat",
    repoUrls: ["fixtures/toy-repo"],
  });
  ingestEvents(run.id, [
    {
      id: "agent-end-1",
      runId: run.id,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: "info",
      kind: "agent.end",
      title: "done",
    },
  ]);
  assert.equal(getRun(run.id)?.status, "IDLE");
  const before = listRuns().length;
  reloadPersistedState();
  const restored = getRun(run.id);
  assert.ok(restored);
  assert.equal(restored.status, "IDLE");
  assert.equal(restored.prompt, "keep this chat");
  assert.equal(listRuns().length, before);
  assert.ok(listEvents(run.id).some((item) => item.kind === "user.message"));
  assert.ok(listEvents(run.id).some((item) => item.kind === "run.idle"));
});

test("createRun fails when the local repo path does not exist", async () => {
  const run = await createRun({
    prompt: "nope",
    repoUrls: ["fixtures/does-not-exist"],
  });
  assert.equal(run.status, "ERROR");
  assert.match(run.errorMessage ?? "", /not found/);
  assert.ok(listEvents(run.id).some((item) => item.kind === "scm.clone_failed"));
});

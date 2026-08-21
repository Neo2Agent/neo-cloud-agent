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

const {
  commitRun,
  createRun,
  enqueueFollowUp,
  getBootstrap,
  getRun,
  getRunSession,
  ingestEvents,
  listRuns,
  mintRunGitToken,
  openRunDraftPr,
  recoverLiveWorkers,
  reloadPersistedState,
  expireStaleWorkers,
  saveRunSession,
  takeInbound,
} = await import("./orchestrator.js");
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
  assert.equal(existsSync(path.join(bootstrap.workspaceDir, ".neo-terminal")), false);
  assert.equal(run.setupStatus, "INSTALL_SUCCEEDED");
  assert.match(run.branchName ?? "", /^neo\/list-files-/);
  assert.equal(run.baseBranch, "main");
  assert.equal(run.pullRequests.length, 0);
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
  assert.ok(kinds.includes("scm.branch_created"));
});

test("commit and local draft PR stay on the control plane", async () => {
  const run = await createRun({
    prompt: "open a draft pr",
    repoUrls: ["fixtures/toy-repo"],
  });
  writeFileSync(path.join(getBootstrap(run.id).workspaceDir, "AGENT.md"), "from test\n");
  const committed = await commitRun(run.id, { message: "feat: add AGENT.md" });
  assert.equal(committed.empty, false);
  const bare = mkdtempSync(path.join(tmpdir(), "neo-orch-bare-"));
  const { runGit } = await import("../scm/git.js");
  await runGit(bare, ["init", "--bare"]);
  const opened = await openRunDraftPr(run.id, { title: "open a draft pr", remoteUrl: bare });
  assert.equal(opened.pushed, true);
  assert.equal(opened.pullRequest.draft, true);
  assert.equal(getRun(run.id)?.pullRequests[0]?.url, opened.pullRequest.url);
  assert.ok(listEvents(run.id).some((item) => item.kind === "scm.commit_succeeded"));
  assert.ok(listEvents(run.id).some((item) => item.kind === "scm.pr_opened"));
  const token = mintRunGitToken(run.id, { scope: "push", repoUrl: "fixtures/toy-repo" });
  assert.match(token.token, /^neo\.git\./);
  assert.doesNotMatch(token.token, /GITHUB_TOKEN|ghp-/);
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

test("events and session backups redact runtime secrets", async () => {
  process.env.DEEPSEEK_API_KEY = "sk-should-not-appear-in-events";
  try {
    const run = await createRun({
      prompt: "do not echo sk-should-not-appear-in-events",
      repoUrls: ["fixtures/toy-repo"],
    });
    const dumped = JSON.stringify(listEvents(run.id));
    assert.equal(dumped.includes("sk-should-not-appear-in-events"), false);
    assert.match(dumped, /\[REDACTED\]/);
    saveRunSession(run.id, [
      { name: "turn.jsonl", content: "assistant said sk-should-not-appear-in-events" },
      { name: "../escape.jsonl", content: "nope" },
    ]);
    const session = getRunSession(run.id);
    assert.equal(session.files.some((file) => file.name === "turn.jsonl"), true);
    assert.equal(session.files.some((file) => file.name.includes("escape")), false);
  } finally {
    delete process.env.DEEPSEEK_API_KEY;
  }
});

test("live runs are reattached after a control-plane reload", async () => {
  const run = await createRun({
    prompt: "keep the worker",
    repoUrls: ["fixtures/toy-repo"],
  });
  assert.equal(run.status, "RUNNING");
  reloadPersistedState();
  assert.equal(getRun(run.id)?.status, "RUNNING");
  await recoverLiveWorkers();
  assert.equal(getRun(run.id)?.status, "RUNNING");
  assert.ok(listEvents(run.id).some((item) => item.title === "Reattached existing worker"));
  assert.equal(expireStaleWorkers(Date.now() + 60_000).includes(run.id), false);
});

test("live runs without a worker heartbeat become ERROR", async () => {
  const run = await createRun({
    prompt: "lost worker",
    repoUrls: ["fixtures/toy-repo"],
  });
  reloadPersistedState();
  const expired = expireStaleWorkers(Date.now() + 60_000);
  assert.ok(expired.includes(run.id));
  assert.equal(getRun(run.id)?.status, "ERROR");
  assert.match(getRun(run.id)?.errorMessage ?? "", /heartbeat/);
});

test("follow-up after reload resumes the worker from session backup", async () => {
  const run = await createRun({
    prompt: "resume me",
    repoUrls: ["fixtures/toy-repo"],
  });
  takeInbound(run.id);
  ingestEvents(run.id, [
    {
      id: "agent-end-resume",
      runId: run.id,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: "info",
      kind: "agent.end",
      title: "done",
    },
  ]);
  saveRunSession(run.id, [{ name: "agent/turn.jsonl", content: "{\"type\":\"message\"}\n" }]);
  assert.equal(getRun(run.id)?.status, "IDLE");
  reloadPersistedState();
  assert.equal(getRun(run.id)?.status, "IDLE");

  const follow = await enqueueFollowUp(run.id, { text: "continue the work" });
  assert.equal(follow.delivery, "prompt");
  assert.equal(getRun(run.id)?.status, "RUNNING");
  assert.equal(
    readFileSync(path.join(getBootstrap(run.id).workspaceDir, "sessions", "agent", "turn.jsonl"), "utf8"),
    "{\"type\":\"message\"}\n",
  );
  const inbox = takeInbound(run.id);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0]?.type, "prompt");
  assert.equal("text" in (inbox[0] ?? {}) ? inbox[0]?.text : "", "continue the work");
  assert.ok(listEvents(run.id).some((item) => item.kind === "run.provisioning"));
  assert.ok(listEvents(run.id).some((item) => item.title === "Resuming worker from session backup"));
});

test("fatal start failure marks the run ERROR", async () => {
  const run = await createRun({
    prompt: "start must succeed",
    repoUrls: ["fixtures/toy-repo"],
  });
  ingestEvents(run.id, [
    {
      id: "start-fail-1",
      runId: run.id,
      createdAt: new Date().toISOString(),
      category: "agent_setup",
      level: "error",
      kind: "run.start_failed",
      title: "Environment start failed",
      detail: "exit 7",
      data: { fatal: true },
    },
  ]);
  assert.equal(getRun(run.id)?.status, "ERROR");
  assert.equal(getRun(run.id)?.setupStatus, "START_FAILED");
  assert.match(getRun(run.id)?.errorMessage ?? "", /start|exit 7/i);
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

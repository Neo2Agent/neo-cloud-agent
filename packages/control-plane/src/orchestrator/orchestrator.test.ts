import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "test-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-orch-"));
process.env.WORKER_IDLE_RELEASE_MS = "0";
delete process.env.WORKER_WORKSPACE_MOUNT;

const {
  abortRun,
  archiveRun,
  deleteRun,
  claimDeskRun,
  commitRun,
  createRun,
  enqueueFollowUp,
  getBootstrap,
  getRun,
  getRunDiff,
  getRunDiagnostics,
  getRunSession,
  handoffRun,
  ingestEvents,
  leaseDesk,
  listFollowUps,
  listRuns,
  listRunSubscriptions,
  loadRunIntoMemory,
  mintRunGitToken,
  projectRunCard,
  subscribeRun,
  openRunDraftPr,
  recoverLiveWorkers,
  reloadPersistedState,
  restoreArchivedRun,
  expireStaleWorkers,
  saveRunSession,
  takeInbound,
  deskAssignmentForRun,
  rejectDeskRun,
  releaseDeskRun,
} = await import("./orchestrator.js");
const { bindDeskWorkspace, createDesk, openDeskInbox, takeDeskAssignment, updateDesk } = await import(
  "../desks/store.js"
);
const { eventsForRun, listEvents } = await import("../events/bus.js");

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
  mkdirSync(path.join(bootstrap.workspaceDir, ".neo", "logs"), { recursive: true });
  writeFileSync(path.join(bootstrap.workspaceDir, ".neo", "logs", "start.log"), "start ok\n");
  const diagnostics = getRunDiagnostics(run.id);
  assert.equal(diagnostics.run.id, run.id);
  assert.equal(diagnostics.run.setupStatus, "INSTALL_SUCCEEDED");
  assert.equal(diagnostics.egress.mode, "allow_all");
  assert.ok(diagnostics.events.some((item) => item.kind === "run.install_succeeded"));
  assert.ok(diagnostics.events.some((item) => item.kind === "scm.branch_created"));
  assert.equal(
    diagnostics.logs.some((item) => item.name === "start.log" && item.content.includes("start ok")),
    true,
  );
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

function longAgo(): string {
  return new Date(Date.now() - 10 * 60_000).toISOString();
}

test("reattaching a run whose turn went silent puts the prompt back on the inbox", async () => {
  const run = await createRun({
    prompt: "see the photo",
    repoUrls: ["fixtures/toy-repo"],
    images: [{ mediaType: "image/jpeg", data: "ZmFrZQ" }],
  });
  const taken = takeInbound(run.id);
  assert.equal(taken[0]?.type, "prompt");
  assert.equal(taken[0] && "images" in taken[0] ? taken[0].images?.[0]?.data : "", "ZmFrZQ");
  // The worker answered nothing and stopped emitting well before the restart.
  ingestEvents(run.id, [
    {
      id: "msg-end-stale",
      runId: run.id,
      createdAt: longAgo(),
      category: "agent_run",
      level: "info",
      kind: "message.end",
      title: "Assistant message completed",
    },
  ]);
  reloadPersistedState();
  await recoverLiveWorkers();
  const inbox = takeInbound(run.id);
  assert.equal(inbox[0]?.type, "prompt");
  assert.equal("text" in (inbox[0] ?? {}) ? inbox[0]?.text : "", "see the photo");
  assert.equal(inbox[0] && "images" in inbox[0] ? inbox[0].images?.[0]?.data : "", "ZmFrZQ");
  assert.ok(listEvents(run.id).some((item) => item.title === "中断的回合已自动排队继续"));
});

test("reattaching a worker that is still answering does not replay its prompt", async () => {
  const run = await createRun({
    prompt: "keep writing",
    repoUrls: ["fixtures/toy-repo"],
  });
  takeInbound(run.id);
  // Assistant opened long ago and never closed: the adopted process owns it.
  ingestEvents(run.id, [
    {
      id: "msg-start-open",
      runId: run.id,
      createdAt: longAgo(),
      category: "agent_run",
      level: "info",
      kind: "message.start",
      title: "Assistant message started",
    },
  ]);
  reloadPersistedState();
  await recoverLiveWorkers();
  assert.equal(takeInbound(run.id).length, 0);
  assert.equal(
    listEvents(run.id).some((item) => item.title === "中断的回合已自动排队继续"),
    false,
  );
});

test("detached live runs requeue the unfinished prompt", async () => {
  const run = await createRun({
    prompt: "lost worker",
    repoUrls: ["fixtures/toy-repo"],
  });
  reloadPersistedState();
  takeInbound(run.id);
  const expired = expireStaleWorkers(Date.now() + 60_000);
  assert.ok(expired.includes(run.id));
  assert.equal(getRun(run.id)?.status, "NOT_YET_STARTED");
  assert.equal(getRun(run.id)?.errorMessage, null);
  const inbox = takeInbound(run.id);
  assert.equal(inbox[0]?.type, "prompt");
  assert.equal("text" in (inbox[0] ?? {}) ? inbox[0]?.text : "", "lost worker");
  assert.ok(listEvents(run.id).some((item) => item.kind === "run.queued"));
});

test("recoverLiveWorkers drops a stale VM slot on an idle chat", async () => {
  const run = await createRun({
    prompt: "slot leftover",
    repoUrls: ["fixtures/toy-repo"],
  });
  takeInbound(run.id);
  ingestEvents(run.id, [
    {
      id: "agent-end-slot",
      runId: run.id,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: "info",
      kind: "agent.end",
      title: "done",
    },
  ]);
  const idle = getRun(run.id);
  assert.ok(idle);
  idle.vmSlotId = "slot-0";
  reloadPersistedState();
  const reloaded = getRun(run.id);
  assert.ok(reloaded);
  reloaded.vmSlotId = "slot-0";
  await recoverLiveWorkers();
  assert.equal(getRun(run.id)?.status, "IDLE");
  assert.equal(getRun(run.id)?.vmSlotId, null);
});

test("detached runs stay idle when the last turn already finished", async () => {
  const run = await createRun({
    prompt: "already done",
    repoUrls: ["fixtures/toy-repo"],
  });
  takeInbound(run.id);
  ingestEvents(run.id, [
    {
      id: "agent-end-idle",
      runId: run.id,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: "info",
      kind: "agent.end",
      title: "done",
    },
  ]);
  reloadPersistedState();
  expireStaleWorkers(Date.now() + 60_000);
  assert.equal(getRun(run.id)?.status, "IDLE");
  assert.equal(takeInbound(run.id).length, 0);
});

test("queued runs are not marked dead while waiting for a VM slot", async () => {
  const run = await createRun({
    prompt: "wait in line",
    repoUrls: ["fixtures/toy-repo"],
  });
  reloadPersistedState();
  const expired = expireStaleWorkers(Date.now() + 60_000);
  assert.ok(expired.includes(run.id));
  assert.equal(getRun(run.id)?.status, "NOT_YET_STARTED");
  assert.equal(expireStaleWorkers(Date.now() + 120_000).includes(run.id), false);
  assert.equal(getRun(run.id)?.status, "NOT_YET_STARTED");
});

test("abort without a worker leaves the chat idle so it can continue", async () => {
  const run = await createRun({
    prompt: "lost then abort",
    repoUrls: ["fixtures/toy-repo"],
  });
  reloadPersistedState();
  takeInbound(run.id);
  expireStaleWorkers(Date.now() + 60_000);
  assert.equal(getRun(run.id)?.status, "NOT_YET_STARTED");
  const aborted = abortRun(run.id);
  assert.equal(aborted.status, "IDLE");
  assert.equal(aborted.errorMessage, null);
  const follow = await enqueueFollowUp(run.id, { text: "try again" });
  assert.equal(follow.text, "try again");
  assert.notEqual(getRun(run.id)?.status, "ERROR");
});

test("recoverLiveWorkers heals chats left in heartbeat ERROR", async () => {
  const run = await createRun({
    prompt: "heal me",
    repoUrls: ["fixtures/toy-repo"],
  });
  reloadPersistedState();
  takeInbound(run.id);
  const loaded = getRun(run.id);
  assert.ok(loaded);
  loaded.status = "ERROR";
  loaded.errorMessage = "worker heartbeat lost after control plane restart";
  await recoverLiveWorkers();
  const healed = getRun(run.id);
  assert.ok(healed);
  assert.notEqual(healed.status, "ERROR");
  assert.equal(healed.errorMessage, null);
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

test("follow-up after a completed turn carries conversation replay for a fresh worker", async () => {
  const run = await createRun({
    prompt: "郑州明天天气",
    repoUrls: ["fixtures/toy-repo"],
  });
  takeInbound(run.id);
  const at = new Date().toISOString();
  ingestEvents(run.id, [
    {
      id: "weather-start",
      runId: run.id,
      createdAt: at,
      category: "agent_run",
      level: "info",
      kind: "message.start",
      title: "start",
    },
    {
      id: "weather-delta",
      runId: run.id,
      createdAt: at,
      category: "agent_run",
      level: "info",
      kind: "message.delta",
      title: "delta",
      data: { delta: "明天 23–27°C，多云" },
    },
    {
      id: "weather-end",
      runId: run.id,
      createdAt: at,
      category: "agent_run",
      level: "info",
      kind: "message.end",
      title: "end",
    },
    {
      id: "weather-agent-end",
      runId: run.id,
      createdAt: at,
      category: "agent_run",
      level: "info",
      kind: "agent.end",
      title: "done",
    },
  ]);
  await enqueueFollowUp(run.id, { text: "我们刚才聊了什么" });
  const inbox = takeInbound(run.id);
  const prompt = inbox.find((item) => item.type === "prompt" || item.type === "follow_up");
  assert.ok(prompt && "text" in prompt);
  assert.equal(prompt.text, "我们刚才聊了什么");
  assert.match(prompt.conversationReplay ?? "", /郑州明天天气/);
  assert.match(prompt.conversationReplay ?? "", /23–27°C/);
  assert.doesNotMatch(prompt.conversationReplay ?? "", /我们刚才聊了什么/);
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

test("cloud createRun drops a missing host folder instead of failing prepare", async () => {
  const run = await createRun({
    prompt: "ignore stale desk folder",
    repoUrls: ["/tmp/desk-local-verify-missing"],
    source: "web",
    target: { loop: "cloud", tools: "cloud" },
  });
  assert.notEqual(run.status, "ERROR");
  assert.deepEqual(run.repoUrls, []);
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

test("allowlist_only blocks a remote host before clone", async () => {
  const { createEnvironment } = await import("../env/store.js");
  const env = createEnvironment(
    {
      name: "locked",
      repoUrls: ["https://evil.example/nope.git"],
      config: { egress: { mode: "allowlist_only", domains: ["pkgs.example"] } },
    },
    "org_local",
  );
  const run = await createRun({
    prompt: "should not leave the allowlist",
    repoUrls: ["https://evil.example/nope.git"],
    envId: env.id,
  });
  assert.equal(run.status, "ERROR");
  assert.match(run.errorMessage ?? "", /evil.example/);
  assert.ok(listEvents(run.id).some((item) => item.kind === "egress.denied"));
  assert.equal(listEvents(run.id).some((item) => item.kind === "scm.clone_started"), false);
});

test("later runs reuse the captured environment build and skip install", async () => {
  const run = await createRun({
    prompt: "reuse the snapshot",
    repoUrls: ["fixtures/toy-repo"],
  });
  assert.equal(run.status, "RUNNING");
  assert.equal(run.setupStatus, "INSTALL_SUCCEEDED");
  assert.ok(run.buildId);
  assert.equal(readFileSync(path.join(getBootstrap(run.id).workspaceDir, ".neo-installed"), "utf8").trim(), "ok");
  const kinds = listEvents(run.id).map((item) => item.kind);
  assert.ok(kinds.includes("build.used"));
  assert.equal(kinds.includes("run.install_started"), false);
  assert.ok(listEvents(run.id).some((item) => item.category === "build"));
  const used = listEvents(run.id).find((item) => item.kind === "build.used");
  assert.ok(used?.data?.cloneMethod === "rename" || used?.data?.cloneMethod === "copy" || used?.data?.cloneMethod === "reflink");
});

test("archiving drops the hot event log but transcript can still reload from persist", async () => {
  const run = await createRun({
    prompt: "archive after a short turn",
    repoUrls: ["fixtures/toy-repo"],
  });
  ingestEvents(run.id, [
    {
      id: `${run.id}-d1`,
      runId: run.id,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: "info",
      kind: "message.delta",
      title: "Assistant text",
      data: { delta: "Hi" },
    },
  ]);
  assert.ok(listEvents(run.id).length > 0);
  await archiveRun(run.id);
  assert.equal(getRun(run.id)?.status, "ARCHIVED");
  assert.equal(listEvents(run.id).length, 0);
  assert.ok(eventsForRun(run.id).some((item) => item.kind === "run.archived"));
});

test("deleteRun soft-deletes archived runs and hides them from the list", async () => {
  const run = await createRun({
    prompt: "delete after archive",
    repoUrls: ["fixtures/toy-repo"],
  });
  await assert.rejects(() => deleteRun(run.id), /只能删除已归档的任务/);
  await archiveRun(run.id);
  const deleted = await deleteRun(run.id);
  assert.equal(deleted.ok, true);
  assert.equal(deleted.id, run.id);
  assert.ok(deleted.deletedAt);
  assert.equal(getRun(run.id), undefined);
  assert.equal(listRuns().some((item) => item.id === run.id), false);
  const persisted = JSON.parse(readFileSync(path.join(process.env.RUNS_DIR!, ".control", `${run.id}.json`), "utf8")) as {
    run: { deletedAt?: string | null };
  };
  assert.ok(persisted.run.deletedAt);
  reloadPersistedState();
  assert.equal(getRun(run.id), undefined);
  assert.equal(listRuns().some((item) => item.id === run.id), false);
  assert.equal(await restoreArchivedRun(run.id), undefined);
  assert.equal(await loadRunIntoMemory(run.id), undefined);
});

test("context.usage stores the model's window and does not invent one", async () => {
  const run = await createRun({
    prompt: "show context",
    repoUrls: ["fixtures/toy-repo"],
    model: "deepseek-v4-flash",
  });
  ingestEvents(run.id, [
    {
      id: `${run.id}-ctx`,
      runId: run.id,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: "info",
      kind: "context.usage",
      title: "Context usage",
      data: {
        tokens: 2400,
        contextWindow: 1_000_000,
        percent: 0.24,
        source: "session",
        model: "deepseek-v4-flash",
        buckets: [
          {
            id: "tools",
            label: "内置工具",
            tokens: 1800,
            children: [
              { id: "read", label: "read", tokens: 1200 },
              { id: "bash", label: "bash", tokens: 600 },
            ],
          },
          { id: "conversation", label: "对话", tokens: 600 },
        ],
      },
    },
  ]);
  assert.equal(getRun(run.id)?.contextUsage?.contextWindow, 1_000_000);
  assert.equal(getRun(run.id)?.contextUsage?.tokens, 2400);
  assert.deepEqual(
    getRun(run.id)?.contextUsage?.buckets.find((bucket) => bucket.id === "tools")?.children?.map((item) => item.id),
    ["read", "bash"],
  );

  const other = await createRun({
    prompt: "unknown model",
    repoUrls: ["fixtures/toy-repo"],
    model: "mystery-local",
  });
  ingestEvents(other.id, [
    {
      id: `${other.id}-ctx`,
      runId: other.id,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: "info",
      kind: "context.usage",
      title: "Context usage",
      data: { tokens: 80, contextWindow: null, source: "estimate", buckets: [] },
    },
  ]);
  assert.equal(getRun(other.id)?.contextUsage?.contextWindow, null);
});

test("subscriptions persist across control-plane reload", async () => {
  const run = await createRun({
    prompt: "watch ci",
    repoUrls: ["fixtures/toy-repo"],
  });
  run.pullRequests.push({
    repoUrl: "https://github.com/acme/app",
    branch: run.branchName ?? "neo/watch",
    url: "https://github.com/acme/app/pull/4",
    draft: true,
    number: 4,
    title: "CI",
  });
  const created = subscribeRun(run.id, { events: ["ci"] });
  assert.equal(created.subscriptions.length, 1);
  assert.equal(created.subscriptions[0]?.kind, "github_ci");
  reloadPersistedState();
  const restored = listRunSubscriptions(run.id);
  assert.equal(restored.length, 1);
  assert.equal(restored[0]?.repo, "acme/app");
  assert.equal(restored[0]?.prNumber, 4);
});

function newDesk(hostname: string, allowRemote = false) {
  const created = createDesk({ name: hostname, hostname, platform: "linux" }, {
    userId: process.env.DEFAULT_USER_ID ?? "user_local",
    orgId: process.env.DEFAULT_ORG_ID ?? "org_local",
  });
  if (allowRemote) {
    updateDesk(created.desk.id, { allowRemote: true });
  }
  return created;
}

test("desk target waits for a claim instead of spawning a server worker", async () => {
  const registered = newDesk("box", true);
  const bound = bindDeskWorkspace(registered.desk.id, { name: "app", repoKey: "local:app", git: true });
  // The desk is connected; lease is the catch-up path for anything already queued.
  const detach = openDeskInbox(registered.desk.id, () => undefined);
  const waiting = leaseDesk(registered.desk.id, 2_000);
  const run = await createRun({
    prompt: "edit the local file",
    repoUrls: [],
    source: "desk",
    deskWorkspaceId: bound.id,
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  assert.equal(run.status, "NOT_YET_STARTED");
  assert.equal(run.executionTarget?.loop, "desk");
  assert.equal(run.executionTarget?.deskWorkspaceId, bound.id);
  const leased = await waiting;
  assert.equal(leased.assignment?.runId, run.id);
  assert.equal(leased.assignment?.workspaceId, bound.id);
  const claimed = await claimDeskRun(registered.desk.id, {
    runId: run.id,
    workspaceDir: "/tmp/neo-desk-ws",
    pid: process.pid,
  });
  assert.equal(claimed.status, "RUNNING");
  assert.equal(getBootstrap(run.id).workspaceDir, "/tmp/neo-desk-ws");
  detach();
});

test("an inline desk run is handed its assignment instead of queueing for a claim", async () => {
  const registered = newDesk("inline-box");
  const events: unknown[] = [];
  const detach = openDeskInbox(registered.desk.id, (event) => events.push(event));
  const run = await createRun({
    prompt: "edit in place",
    repoUrls: ["/home/me/app"],
    source: "desk",
    start: "inline",
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  // The caller is the desk, so nothing is pushed to it and nothing is queued for pickup.
  assert.equal(events.length, 0);
  const assignment = deskAssignmentForRun(run.id);
  assert.equal(assignment.runId, run.id);
  assert.ok(assignment.jwt.split(".").length === 3);
  assert.equal(takeDeskAssignment(registered.desk.id), null);
  detach();
});

test("inline works without a bound workspace because the desk knows its own folder", async () => {
  const registered = newDesk("unbound-box");
  const folder = "C:\\Users\\me\\测试";
  const run = await createRun({
    prompt: "just this folder",
    repoUrls: [folder],
    source: "desk",
    start: "inline",
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  assert.equal(run.executionTarget?.deskId, registered.desk.id);
  assert.equal(run.executionTarget?.deskWorkspaceId, undefined);
  assert.deepEqual(run.repoUrls, [folder]);
});

test("remote dispatch needs a bound workspace and rides the desk inbox", async () => {
  const registered = newDesk("remote-box", true);
  const pushed: Array<{ kind: string }> = [];
  const detach = openDeskInbox(registered.desk.id, (event) => pushed.push(event));
  await assert.rejects(
    () =>
      createRun({
        prompt: "from the web",
        repoUrls: [],
        source: "web",
        target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
      }),
    /还没有绑定本机工作区/,
  );
  const bound = bindDeskWorkspace(registered.desk.id, { name: "app", repoKey: "github.com/acme/app", git: true });
  const run = await createRun({
    prompt: "from the web",
    repoUrls: ["https://github.com/acme/app.git"],
    source: "web",
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  assert.equal(run.status, "NOT_YET_STARTED");
  assert.equal(run.executionTarget?.deskWorkspaceId, bound.id);
  assert.equal(pushed.filter((item) => item.kind === "assignment").length, 1);
  detach();
});

test("a dispatch for another repo is refused instead of running in the wrong folder", async () => {
  const registered = newDesk("wrong-repo-box", true);
  const bound = bindDeskWorkspace(registered.desk.id, { name: "app", repoKey: "github.com/acme/app", git: true });
  const detach = openDeskInbox(registered.desk.id, () => undefined);
  await assert.rejects(
    () =>
      createRun({
        prompt: "wrong repo",
        repoUrls: ["https://github.com/acme/other.git"],
        source: "web",
        deskWorkspaceId: bound.id,
        target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
      }),
    /别的仓库/,
  );
  detach();
});

test("an offline desk or a closed remote switch fails fast, with no queued run", async () => {
  const registered = newDesk("offline-box", true);
  bindDeskWorkspace(registered.desk.id, { name: "app", repoKey: "github.com/acme/app", git: true });
  const before = listRuns().length;
  await assert.rejects(
    () =>
      createRun({
        prompt: "nobody home",
        repoUrls: ["https://github.com/acme/app.git"],
        source: "web",
        target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
      }),
    /没打开 Desk/,
  );
  const detach = openDeskInbox(registered.desk.id, () => undefined);
  updateDesk(registered.desk.id, { allowRemote: false });
  await assert.rejects(
    () =>
      createRun({
        prompt: "switch is off",
        repoUrls: ["https://github.com/acme/app.git"],
        source: "web",
        target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
      }),
    /关闭了远程派活/,
  );
  assert.equal(listRuns().length, before);
  detach();
});

test("automations never land on a personal machine", async () => {
  const registered = newDesk("automation-box", true);
  bindDeskWorkspace(registered.desk.id, { name: "app", repoKey: "github.com/acme/app", git: true });
  const detach = openDeskInbox(registered.desk.id, () => undefined);
  await assert.rejects(
    () =>
      createRun({
        prompt: "nightly",
        repoUrls: ["https://github.com/acme/app.git"],
        source: "automation",
        target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
      }),
    /定时任务不能派到本机/,
  );
  detach();
});

test("a rejected dispatch reports why instead of waiting forever", async () => {
  const registered = newDesk("reject-box", true);
  const bound = bindDeskWorkspace(registered.desk.id, { name: "app", repoKey: "local:app", git: true });
  const detach = openDeskInbox(registered.desk.id, () => undefined);
  const run = await createRun({
    prompt: "will be refused",
    repoUrls: [],
    source: "web",
    deskWorkspaceId: bound.id,
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  const rejected = rejectDeskRun(registered.desk.id, run.id, "工作区已经不在了");
  assert.equal(rejected.status, "ERROR");
  assert.equal(rejected.errorMessage, "工作区已经不在了");
  assert.equal(takeDeskAssignment(registered.desk.id), null);
  detach();
});

test("a per-turn desk worker releases the run, and the next follow-up is dispatched again", async () => {
  const registered = newDesk("per-turn-box");
  const bound = bindDeskWorkspace(registered.desk.id, { name: "app", repoKey: "local:app", git: true });
  const pushed: Array<{ kind: string }> = [];
  const detach = openDeskInbox(registered.desk.id, (event) => pushed.push(event));
  const run = await createRun({
    prompt: "one turn only",
    repoUrls: [],
    source: "desk",
    start: "inline",
    deskWorkspaceId: bound.id,
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  await claimDeskRun(registered.desk.id, { runId: run.id, workspaceDir: "/tmp/neo-per-turn", pid: 4242 });
  takeInbound(run.id);
  ingestEvents(run.id, [
    {
      id: "end-1",
      runId: run.id,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: "info",
      kind: "agent.end",
      title: "turn done",
    },
  ]);
  assert.equal(getRun(run.id)?.status, "IDLE");

  // The worker exits on purpose after the turn, so no handle should linger.
  const released = releaseDeskRun(registered.desk.id, run.id, { code: 0 });
  assert.equal(released.status, "IDLE");
  assert.equal(released.workerHandle, null);

  pushed.length = 0;
  await enqueueFollowUp(run.id, { text: "second turn" }, { userId: registered.desk.userId, email: "admin" });
  assert.equal(pushed.some((item) => item.kind === "assignment"), true);
  assert.equal(takeDeskAssignment(registered.desk.id), run.id);
  detach();
});

test("one desk runs two workspaces at once, each claiming and releasing on its own", async () => {
  const registered = newDesk("parallel-box");
  const web = bindDeskWorkspace(registered.desk.id, { name: "web", repoKey: "local:web", git: true });
  const api = bindDeskWorkspace(registered.desk.id, { name: "api", repoKey: "local:api", git: true });
  const first = await createRun({
    prompt: "work on web",
    repoUrls: [],
    source: "desk",
    start: "inline",
    deskWorkspaceId: web.id,
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  const second = await createRun({
    prompt: "work on api",
    repoUrls: [],
    source: "desk",
    start: "inline",
    deskWorkspaceId: api.id,
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  await claimDeskRun(registered.desk.id, { runId: first.id, workspaceDir: "/tmp/neo-web", pid: 5151 });
  await claimDeskRun(registered.desk.id, { runId: second.id, workspaceDir: "/tmp/neo-api", pid: 5252 });
  assert.equal(getRun(first.id)?.status, "RUNNING");
  assert.equal(getRun(second.id)?.status, "RUNNING");
  // Each run keeps its own folder; one desk holding two is not a conflict.
  assert.equal(getBootstrap(first.id).workspaceDir, "/tmp/neo-web");
  assert.equal(getBootstrap(second.id).workspaceDir, "/tmp/neo-api");

  // Finishing one must leave the other alone.
  takeInbound(first.id);
  ingestEvents(first.id, [
    {
      id: "end-web",
      runId: first.id,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: "info",
      kind: "agent.end",
      title: "web done",
    },
  ]);
  const releasedFirst = releaseDeskRun(registered.desk.id, first.id, { code: 0 });
  assert.equal(releasedFirst.status, "IDLE");
  assert.equal(releasedFirst.workerHandle, null);
  assert.equal(getRun(second.id)?.status, "RUNNING");
  assert.notEqual(getRun(second.id)?.workerHandle, null);
});

test("git on a desk run says the files are elsewhere instead of spawn git ENOENT", async () => {
  const registered = newDesk("git-box");
  const bound = bindDeskWorkspace(registered.desk.id, { name: "app", repoKey: "local:app", git: true });
  const run = await createRun({
    prompt: "commit my work",
    repoUrls: [],
    source: "desk",
    start: "inline",
    deskWorkspaceId: bound.id,
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  // The laptop's folder does not exist on the control-plane host.
  await claimDeskRun(registered.desk.id, {
    runId: run.id,
    workspaceDir: "/tmp/neo-desk-folder-that-is-on-someone-else-laptop",
    pid: 4244,
  });
  await assert.rejects(() => commitRun(run.id, { message: "wip" }), /控制面看不到/);
  const diff = await getRunDiff(run.id);
  assert.equal(diff.stat, "");
});

test("a desk worker that crashes surfaces the exit code instead of going idle", async () => {
  const registered = newDesk("crash-box");
  const bound = bindDeskWorkspace(registered.desk.id, { name: "app", repoKey: "local:app", git: true });
  const run = await createRun({
    prompt: "will crash",
    repoUrls: [],
    source: "desk",
    start: "inline",
    deskWorkspaceId: bound.id,
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  await claimDeskRun(registered.desk.id, { runId: run.id, workspaceDir: "/tmp/neo-crash", pid: 4243 });
  const released = releaseDeskRun(registered.desk.id, run.id, { code: 2 });
  assert.equal(released.status, "ERROR");
  assert.match(released.errorMessage ?? "", /worker 退出/);
});

test("a desk worker that stops answering is detached, not left running forever", async () => {
  const registered = newDesk("stale-box");
  const bound = bindDeskWorkspace(registered.desk.id, { name: "app", repoKey: "local:app", git: true });
  const run = await createRun({
    prompt: "local turn",
    repoUrls: [],
    source: "desk",
    start: "inline",
    deskWorkspaceId: bound.id,
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  // pid 1 is alive on every host, so a pid check would call this healthy forever.
  await claimDeskRun(registered.desk.id, { runId: run.id, workspaceDir: "/tmp/neo-stale-ws", pid: 1 });
  assert.equal(getRun(run.id)?.status, "RUNNING");
  const expired = expireStaleWorkers(Date.now() + 10 * 60_000);
  assert.ok(expired.includes(run.id));
  assert.notEqual(getRun(run.id)?.status, "RUNNING");
});

test("queued follow-ups stay off the transcript until the worker takes them", async () => {
  const run = await createRun({
    prompt: "A starts the turn",
    repoUrls: ["fixtures/toy-repo"],
  });
  takeInbound(run.id);
  const first = await enqueueFollowUp(
    run.id,
    { text: "A is still talking" },
    { userId: "user-a", email: "admin" },
  );
  const second = await enqueueFollowUp(
    run.id,
    { text: "B is waiting in line" },
    { userId: "user-b", email: "ping" },
  );
  assert.equal(first.status, "queued");
  assert.equal(second.status, "queued");
  assert.equal(
    listEvents(run.id).some((item) => item.kind === "user.message" && item.data?.followUpId === first.id),
    false,
  );
  assert.equal(
    listEvents(run.id).some((item) => item.kind === "user.message" && item.data?.followUpId === second.id),
    false,
  );
  assert.ok(listEvents(run.id).some((item) => item.kind === "followup.queued" && item.data?.followUpId === second.id));
  assert.equal(listFollowUps(run.id).filter((item) => item.status === "queued").length, 2);

  const taken = takeInbound(run.id);
  assert.equal(taken.length, 2);
  assert.equal(
    taken.every((item) => "followUpId" in item && (item.followUpId === first.id || item.followUpId === second.id)),
    true,
  );
  assert.equal(listFollowUps(run.id).every((item) => item.status === "delivered"), true);
  const bubble = listEvents(run.id).find((item) => item.kind === "user.message" && item.data?.followUpId === second.id);
  assert.ok(bubble);
  assert.equal(bubble.data?.text, "B is waiting in line");
  assert.equal(bubble.data?.actorEmail, "ping");
  assert.ok(listEvents(run.id).some((item) => item.kind === "followup.delivered" && item.data?.followUpId === second.id));

  const leftover = takeInbound(run.id);
  assert.equal(leftover.length, 0);
  assert.equal(listEvents(run.id).filter((item) => item.kind === "user.message" && item.data?.followUpId === second.id).length, 1);
});

test("a This Computer conversation cannot be moved to the cloud", async () => {
  const registered = newDesk("box-2");
  const run = await createRun({
    prompt: "stay local",
    repoUrls: ["/tmp/only-local"],
    source: "desk",
    start: "inline",
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  // The work is in the user's own folder, usually uncommitted.
  await assert.rejects(
    () => handoffRun(run.id, { target: { loop: "cloud", tools: "cloud" } }),
    /不能切到云端/,
  );
});

test("handoff back to a machine needs that repo already bound there", async () => {
  const registered = newDesk("handoff-box", true);
  const detach = openDeskInbox(registered.desk.id, () => undefined);
  const run = await createRun({
    prompt: "cloud first",
    repoUrls: ["https://github.com/acme/app.git"],
    source: "web",
  });
  await assert.rejects(
    () => handoffRun(run.id, { target: { loop: "desk", tools: "desk", deskId: registered.desk.id } }),
    /还没有绑定本机工作区/,
  );
  const bound = bindDeskWorkspace(registered.desk.id, { name: "app", repoKey: "github.com/acme/app", git: true });
  const moved = await handoffRun(run.id, {
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  });
  assert.equal(moved.executionTarget?.deskWorkspaceId, bound.id);
  detach();
});

test("createRun stores a title and rejects client object image keys", async () => {
  const run = await createRun({
    prompt: "第一行标题\n第二行",
    repoUrls: ["fixtures/toy-repo"],
  });
  assert.equal(run.title, "第一行标题");
  assert.equal(projectRunCard(run).title, "第一行标题");
  await assert.rejects(
    () =>
      createRun({
        prompt: "forged",
        repoUrls: ["fixtures/toy-repo"],
        images: [{ mediaType: "image/png", data: "obj:runs/other/inbox/x" }],
      }),
    /invalid image payload/,
  );
});

test("queued follow-up images survive reload and leave the queue after deliver", async () => {
  const run = await createRun({
    prompt: "start with a picture",
    repoUrls: ["fixtures/toy-repo"],
  });
  takeInbound(run.id);
  const follow = await enqueueFollowUp(run.id, {
    text: "看这张",
    images: [{ mediaType: "image/png", data: "aW1nZGF0YQ" }],
  });
  reloadPersistedState();
  const inbox = takeInbound(run.id);
  const item = inbox[0];
  assert.ok(item && "images" in item);
  assert.equal(item.images?.[0]?.data, "aW1nZGF0YQ");
  const delivered = listFollowUps(run.id).find((entry) => entry.id === follow.id);
  assert.equal(delivered?.status, "delivered");
  assert.equal(delivered?.source, "user");
  assert.equal(delivered?.images, undefined);
  const published = eventsForRun(run.id).find((event) => event.kind === "user.message" && event.data?.followUpId === follow.id);
  assert.equal((published?.data?.images as Array<{ data: string }> | undefined)?.[0]?.data, "aW1nZGF0YQ");
  reloadPersistedState();
  assert.equal(listFollowUps(run.id).find((entry) => entry.id === follow.id)?.source, "user");
  assert.equal(listFollowUps(run.id).find((entry) => entry.id === follow.id)?.images, undefined);
});

test("deleteRun reclaims the queue file and inbox objects", async () => {
  const run = await createRun({
    prompt: "reclaim after delete",
    repoUrls: ["fixtures/toy-repo"],
  });
  takeInbound(run.id);
  await enqueueFollowUp(run.id, {
    text: "queued pic",
    images: [{ mediaType: "image/png", data: "aW1nZGF0YQ" }],
  });
  await archiveRun(run.id);
  await deleteRun(run.id);
  assert.equal(existsSync(path.join(process.env.RUNS_DIR!, ".control", `${run.id}.queue.json`)), false);
  assert.equal(existsSync(path.join(process.env.RUNS_DIR!, ".objects", "runs", run.id, "inbox")), false);
});

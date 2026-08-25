import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "auto-secret";
const runsDir = mkdtempSync(path.join(tmpdir(), "neo-auto-"));
process.env.RUNS_DIR = runsDir;
process.env.LLM_SETTINGS_DIR = mkdtempSync(path.join(tmpdir(), "neo-auto-settings-"));
delete process.env.CONTROL_PLANE_TOKEN;

const { createFileAccountStore } = await import("../accounts/file.js");
const { setAccountStore } = await import("../accounts/store.js");
setAccountStore(createFileAccountStore(runsDir), "file");

const { createAutomation, dueAutomations, getAutomation, listAutomations, replaceAutomations, updateAutomation } = await import("./store.js");
const { AutomationRunError, fireDueAutomations, runAutomationNow } = await import("./runner.js");
const { getRun } = await import("../orchestrator/orchestrator.js");
const { actorCanAccessRun } = await import("../security/actor.js");
const { claimOrphanAutomations } = await import("./claim.js");
const { getAccountStore } = await import("../accounts/store.js");

test("replaceAutomations reloads the saved list", () => {
  const first = createAutomation({
    prompt: "先写一条",
    schedule: { kind: "every", minutes: 60 },
  });
  replaceAutomations(
    listAutomations().map((item) => (item.id === first.id ? { ...item, name: "从库里回来" } : item)),
  );
  assert.equal(listAutomations().find((item) => item.id === first.id)?.name, "从库里回来");
});

test("createAutomation stores the next Shanghai run time", () => {
  const item = createAutomation({
    prompt: "每天检查测试",
    schedule: { kind: "daily", hour: 9 },
    repoUrls: ["fixtures/toy-repo"],
  });
  assert.equal(item.enabled, true);
  assert.ok(Date.parse(item.nextRunAt) > Date.now());
  assert.equal(listAutomations().some((row) => row.id === item.id), true);
});

test("fireDueAutomations starts a run and pushes the next tick", async () => {
  const item = createAutomation({
    name: "now",
    prompt: "立刻跑一次",
    schedule: { kind: "every", minutes: 60 },
    repoUrls: ["fixtures/toy-repo"],
  });
  updateAutomation(item.id, { nextRunAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(dueAutomations().some((row) => row.id === item.id), true);
  const started = await fireDueAutomations();
  assert.ok(started.length >= 1);
  const run = getRun(started[started.length - 1] ?? "");
  assert.ok(run);
  assert.equal(run?.source, "automation");
  const later = listAutomations().find((row) => row.id === item.id);
  assert.ok(later);
  assert.equal(later?.lastRunId, run?.id);
  assert.ok(Date.parse(later?.nextRunAt ?? "") > Date.now());
  assert.equal(
    actorCanAccessRun(
      { kind: "user", userId: "someone-else", orgId: "org_local", email: "admin", sessionId: "s" },
      run!,
    ),
    true,
  );
});

test("fireDueAutomations owns the chat as the automation creator", async () => {
  const item = createAutomation(
    {
      name: "owned",
      prompt: "用登录账号开对话",
      schedule: { kind: "every", minutes: 60 },
      repoUrls: ["fixtures/toy-repo"],
    },
    { userId: "user_admin", orgId: "org_local" },
  );
  updateAutomation(item.id, { nextRunAt: new Date(Date.now() - 1000).toISOString() });
  const started = await fireDueAutomations();
  const run = getRun(started[started.length - 1] ?? "");
  assert.equal(run?.userId, "user_admin");
  assert.equal(run?.source, "automation");
  assert.equal(
    actorCanAccessRun(
      { kind: "user", userId: "user_admin", orgId: "org_local", email: "admin", sessionId: "s" },
      run!,
    ),
    true,
  );
});

test("runAutomationNow starts a chat without moving the next tick", async () => {
  const item = createAutomation(
    {
      name: "reuse-now",
      prompt: "复用这条自动化立刻开对话",
      schedule: { kind: "every", minutes: 60 },
      repoUrls: ["fixtures/toy-repo"],
    },
    { userId: "user_admin", orgId: "org_local" },
  );
  const scheduled = item.nextRunAt;
  const run = await runAutomationNow(item.id, { userId: "user_admin", orgId: "org_local" });
  assert.equal(run.source, "automation");
  assert.equal(run.prompt, "复用这条自动化立刻开对话");
  assert.equal(run.userId, "user_admin");
  assert.deepEqual(run.repoUrls, ["fixtures/toy-repo"]);
  const later = getAutomation(item.id);
  assert.equal(later?.lastRunId, run.id);
  assert.equal(later?.nextRunAt, scheduled);
});

test("runAutomationNow rejects missing, foreign, and still-running automations", async () => {
  await assert.rejects(
    () => runAutomationNow("auto_missing", { userId: "user_admin", orgId: "org_local" }),
    (error: unknown) => error instanceof AutomationRunError && error.status === 404,
  );
  const owned = createAutomation(
    {
      name: "owned-only",
      prompt: "别人不能点",
      schedule: { kind: "every", minutes: 60 },
    },
    { userId: "user_admin", orgId: "org_local" },
  );
  await assert.rejects(
    () => runAutomationNow(owned.id, { userId: "user_ping", orgId: "org_local" }),
    (error: unknown) => error instanceof AutomationRunError && error.status === 403,
  );
  const busy = createAutomation(
    {
      name: "busy",
      prompt: "上一轮还在跑",
      schedule: { kind: "every", minutes: 60 },
    },
    { userId: "user_admin", orgId: "org_local" },
  );
  await runAutomationNow(busy.id, { userId: "user_admin", orgId: "org_local" });
  await assert.rejects(
    () => runAutomationNow(busy.id, { userId: "user_admin", orgId: "org_local" }),
    (error: unknown) => error instanceof AutomationRunError && error.status === 409,
  );
});

test("claimOrphanAutomations gives the default admin yesterday's system-owned chat", async () => {
  const store = getAccountStore();
  const admin = await store.createUser({
    id: "admin-claim",
    email: "admin",
    passwordHash: "x",
    orgId: "org_local",
    createdAt: new Date().toISOString(),
  });
  const item = createAutomation({
    prompt: "旧任务没有主人",
    schedule: { kind: "every", minutes: 60 },
    repoUrls: ["fixtures/toy-repo"],
  });
  updateAutomation(item.id, { nextRunAt: new Date(Date.now() - 1000).toISOString() });
  const started = await fireDueAutomations();
  const run = getRun(started[started.length - 1] ?? "");
  assert.equal(run?.userId, "user_local");
  await claimOrphanAutomations();
  const owned = listAutomations().find((row) => row.id === item.id);
  assert.equal(owned?.userId, admin.id);
  assert.equal(getRun(run!.id)?.userId, admin.id);
});

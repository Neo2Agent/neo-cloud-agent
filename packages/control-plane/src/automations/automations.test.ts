import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "auto-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-auto-"));
process.env.LLM_SETTINGS_DIR = mkdtempSync(path.join(tmpdir(), "neo-auto-settings-"));
delete process.env.CONTROL_PLANE_TOKEN;

const { createAutomation, dueAutomations, listAutomations, replaceAutomations, updateAutomation } = await import("./store.js");
const { fireDueAutomations } = await import("./runner.js");
const { getRun } = await import("../orchestrator/orchestrator.js");

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
});

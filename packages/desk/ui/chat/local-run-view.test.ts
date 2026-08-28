import assert from "node:assert/strict";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts/run";
import type { DeskRunStatus } from "../desk.js";
import {
  localRunView,
  otherRunningLocalRuns,
  runningLocalRunIds,
  type LocalRunStatuses,
} from "./local-run-view.js";

function localRun(id: string, status: Run["status"], folder = "/home/me/api"): Run {
  return {
    id,
    status,
    repoUrls: [folder],
    executionTarget: { loop: "desk", tools: "desk" },
  } as unknown as Run;
}

function cloudRun(id: string): Run {
  return {
    id,
    status: "RUNNING",
    repoUrls: ["https://github.com/me/api"],
    executionTarget: { loop: "cloud", tools: "cloud" },
  } as unknown as Run;
}

function statuses(...items: DeskRunStatus[]): LocalRunStatuses {
  return Object.fromEntries(items.map((item) => [item.runId, item]));
}

test("a cloud run has no local view at all", () => {
  const view = localRunView(cloudRun("run-a"), {});
  assert.equal(view.isLocal, false);
  assert.equal(view.folder, "");
  assert.equal(view.needsRestart, false);
});

test("no open run has no local view either", () => {
  assert.equal(localRunView(null, {}).isLocal, false);
  assert.equal(localRunView(undefined, {}).isLocal, false);
});

test("a finished turn with nothing owed is idle, not broken", () => {
  const view = localRunView(
    localRun("run-a", "IDLE"),
    statuses({ runId: "run-a", state: "stopped" }),
  );
  assert.equal(view.idle, true);
  assert.equal(view.needsRestart, false);
  assert.equal(view.workerDown, true);
});

test("work owed with no worker is what needs a restart", () => {
  const view = localRunView(
    localRun("run-a", "RUNNING"),
    statuses({ runId: "run-a", state: "stopped" }),
  );
  assert.equal(view.needsRestart, true);
  assert.equal(view.idle, false);
});

test("a queued run this window never launched also needs a restart", () => {
  // No status at all: the main process reports one the moment it starts.
  const view = localRunView(localRun("run-a", "NOT_YET_STARTED"), {});
  assert.equal(view.needsRestart, true);
  assert.equal(view.status, undefined);
});

test("a running worker is neither idle nor down", () => {
  const view = localRunView(
    localRun("run-a", "RUNNING"),
    statuses({ runId: "run-a", state: "running" }),
  );
  assert.equal(view.workerDown, false);
  assert.equal(view.idle, false);
  assert.equal(view.needsRestart, false);
});

test("a failed start counts as down so the composer stops claiming a live turn", () => {
  const view = localRunView(
    localRun("run-a", "RUNNING"),
    statuses({ runId: "run-a", state: "failed", detail: "本机启动失败" }),
  );
  assert.equal(view.workerDown, true);
  assert.equal(view.status?.detail, "本机启动失败");
});

test("the view follows the run's own folder, not another run's", () => {
  const both = statuses(
    { runId: "run-a", state: "running", workspace: "/home/me/web" },
    { runId: "run-b", state: "running", workspace: "/home/me/api" },
  );
  assert.equal(localRunView(localRun("run-a", "RUNNING", "/home/me/web"), both).folder, "/home/me/web");
  assert.equal(localRunView(localRun("run-b", "RUNNING", "/home/me/api"), both).folder, "/home/me/api");
});

test("starting and running hold a worker; stopped and failed do not", () => {
  const ids = runningLocalRunIds(
    statuses(
      { runId: "run-a", state: "starting" },
      { runId: "run-b", state: "running" },
      { runId: "run-c", state: "stopped" },
      { runId: "run-d", state: "failed" },
    ),
  );
  assert.deepEqual([...ids].sort(), ["run-a", "run-b"]);
});

test("the other-runs count leaves out the conversation you are looking at", () => {
  const busy = statuses(
    { runId: "run-a", state: "running" },
    { runId: "run-b", state: "running" },
    { runId: "run-c", state: "starting" },
  );
  assert.equal(otherRunningLocalRuns(busy, "run-a"), 2);
  assert.equal(otherRunningLocalRuns(busy, null), 3);
  assert.equal(otherRunningLocalRuns({}, "run-a"), 0);
});

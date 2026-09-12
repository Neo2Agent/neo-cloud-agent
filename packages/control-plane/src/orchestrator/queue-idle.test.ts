import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";
import { isDeskToolsTarget } from "@neo-cloud-agent/contracts";
import type { AgentRuntime } from "../runtime/factory.js";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.AGENT_KERNEL = "pi";
process.env.LLM_GATEWAY_JWT_SECRET = "queue-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-queue-"));
process.env.WORKER_IDLE_RELEASE_MS = "1";
delete process.env.WORKER_WORKSPACE_MOUNT;

const { createRun, expireIdleWorkers, getRun, ingestEvents, takeInbound, tryStartQueued } = await import("./orchestrator.js");
const { setRuntimeForTests } = await import("../runtime/factory.js");
const { listEvents } = await import("../events/bus.js");
const { setPersistRunWorkspaceForTests } = await import("../runtime/persist-workspace.js");
const { createDesk } = await import("../desks/store.js");

function fakeRuntime(opts: { busy?: boolean } = {}): AgentRuntime & { destroyed: string[]; busy: boolean } {
  const state = { busy: Boolean(opts.busy), destroyed: [] as string[] };
  return {
    get busy() {
      return state.busy;
    },
    set busy(value: boolean) {
      state.busy = value;
    },
    destroyed: state.destroyed,
    async provision(spec: RuntimeSpec): Promise<RuntimeHandle> {
      if (state.busy) {
        throw new Error("all VM slots are busy (2/2)");
      }
      return { id: `fake-${spec.runId}`, runtime: "none", ip: null };
    },
    async destroy(handle: RuntimeHandle): Promise<void> {
      state.destroyed.push(handle.id);
    },
    async adopt(): Promise<RuntimeHandle | null> {
      return null;
    },
  };
}

test.describe("queue and idle release", { concurrency: 1 }, () => {
test("createRun queues when every VM slot is busy and starts after a slot frees", async () => {
  const runtime = fakeRuntime({ busy: true });
  setRuntimeForTests(runtime);
  try {
    const run = await createRun({
      prompt: "please wait",
      repoUrls: ["fixtures/toy-repo"],
    });
    assert.equal(run.status, "NOT_YET_STARTED");
    assert.ok(listEvents(run.id).some((item) => item.kind === "run.queued"));
    runtime.busy = false;
    const started = await tryStartQueued();
    assert.equal(started, run.id);
    assert.equal(getRun(run.id)?.status, "RUNNING");
  } finally {
    setRuntimeForTests();
  }
});

test("idle workers are released without marking ERROR", async () => {
  const runtime = fakeRuntime();
  setRuntimeForTests(runtime);
  try {
    const run = await createRun({
      prompt: "then rest",
      repoUrls: ["fixtures/toy-repo"],
    });
    assert.equal(run.status, "RUNNING");
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
    assert.equal(getRun(run.id)?.status, "IDLE");
    const released = await expireIdleWorkers(Date.now() + 50);
    assert.ok(released.includes(run.id));
    assert.equal(getRun(run.id)?.status, "IDLE");
    assert.equal(getRun(run.id)?.workerHandle, null);
    assert.ok(runtime.destroyed.some((id) => id.includes(run.id)));
    assert.equal(getRun(run.id)?.errorMessage, null);
  } finally {
    setRuntimeForTests();
  }
});

test("a queued chat frees an idle VM instead of waiting out the hold", async () => {
  const runtime = fakeRuntime();
  setRuntimeForTests(runtime);
  try {
    const idle = await createRun({
      prompt: "done talking",
      repoUrls: ["fixtures/toy-repo"],
    });
    takeInbound(idle.id);
    ingestEvents(idle.id, [
      {
        id: "agent-end-yield",
        runId: idle.id,
        createdAt: new Date().toISOString(),
        category: "agent_run",
        level: "info",
        kind: "agent.end",
        title: "done",
      },
    ]);
    assert.equal(getRun(idle.id)?.status, "IDLE");
    runtime.busy = true;
    const waiting = await createRun({
      prompt: "hello after restart",
      repoUrls: ["fixtures/toy-repo"],
    });
    assert.equal(waiting.status, "NOT_YET_STARTED");
    runtime.busy = false;
    const released = await expireIdleWorkers(Date.now());
    assert.ok(released.includes(idle.id));
    assert.equal(getRun(waiting.id)?.status, "RUNNING");
  } finally {
    setRuntimeForTests();
  }
});

test("a stuck desk NOT_YET_STARTED does not force early idle VM release", async () => {
  const runtime = fakeRuntime();
  setRuntimeForTests(runtime);
  try {
    const registered = createDesk(
      { name: "idle-box", hostname: "idle-box", platform: "linux" },
      {
        userId: process.env.DEFAULT_USER_ID ?? "user_local",
        orgId: process.env.DEFAULT_ORG_ID ?? "org_local",
      },
    );
    const desk = await createRun({
      prompt: "wait on this computer",
      repoUrls: [],
      source: "desk",
      start: "inline",
      target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
    });
    assert.equal(desk.status, "NOT_YET_STARTED");
    assert.equal(desk.source, "desk");
    assert.equal(isDeskToolsTarget(desk.executionTarget), true);

    const cloud = await createRun({
      prompt: "keep my cloud slot",
      repoUrls: ["fixtures/toy-repo"],
    });
    takeInbound(cloud.id);
    ingestEvents(cloud.id, [
      {
        id: "agent-end-keep-slot",
        runId: cloud.id,
        createdAt: new Date().toISOString(),
        category: "agent_run",
        level: "info",
        kind: "agent.end",
        title: "done",
      },
    ]);
    assert.equal(getRun(cloud.id)?.status, "IDLE");
    assert.ok(getRun(cloud.id)?.workerHandle);

    const released = await expireIdleWorkers(Date.now());
    assert.equal(released.includes(cloud.id), false);
    assert.ok(getRun(cloud.id)?.workerHandle);
    assert.equal(getRun(desk.id)?.status, "NOT_YET_STARTED");
  } finally {
    setRuntimeForTests();
  }
});

test("idle release keeps the worker when workspace persist fails", async () => {
  const runtime = fakeRuntime();
  setRuntimeForTests(runtime);
  setPersistRunWorkspaceForTests(async () => ({ ok: false, error: "disk full" }));
  try {
    const run = await createRun({
      prompt: "keep the files",
      repoUrls: ["fixtures/toy-repo"],
    });
    takeInbound(run.id);
    ingestEvents(run.id, [
      {
        id: "agent-end-keep",
        runId: run.id,
        createdAt: new Date().toISOString(),
        category: "agent_run",
        level: "info",
        kind: "agent.end",
        title: "done",
      },
    ]);
    const released = await expireIdleWorkers(Date.now() + 50);
    assert.equal(released.includes(run.id), false);
    assert.ok(getRun(run.id)?.workerHandle);
    assert.equal(runtime.destroyed.length, 0);
    assert.ok(listEvents(run.id).some((item) => item.kind === "workspace.persist_failed"));
  } finally {
    setPersistRunWorkspaceForTests();
    setRuntimeForTests();
  }
});
});

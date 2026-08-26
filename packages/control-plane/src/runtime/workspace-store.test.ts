import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts";
import { hostWorkspaceFor } from "../worker-spawn.js";
import {
  evictHostWorkspace,
  loadWorkspaceMeta,
  markWorkspacePresent,
  reclaimPersistedWorkspaces,
} from "./workspace-store.js";

function sampleRun(id: string, status: Run["status"], updatedAt: string): Run {
  return {
    id,
    orgId: "org_local",
    userId: "user_local",
    envId: null,
    envVersionId: null,
    buildId: null,
    status,
    setupStatus: "INSTALL_SUCCEEDED",
    source: "api",
    model: "neo/deepseek",
    prompt: "hello",
    branchName: null,
    baseBranch: null,
    repoUrls: ["fixtures/toy-repo"],
    pullRequests: [],
    workerHandle: null,
    vmSlotId: null,
    createdAt: updatedAt,
    updatedAt,
    idleAt: updatedAt,
    expiresAt: null,
    errorMessage: null,
  };
}

function writeWorkspace(runId: string, name: string, bytes: number): void {
  const dir = hostWorkspaceFor(runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), "x".repeat(bytes));
  markWorkspacePresent(runId, bytes);
}

test("reclaim evicts archived workspaces past TTL and skips protected runs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-ws-ttl-"));
  const previous = {
    RUNS_DIR: process.env.RUNS_DIR,
    HOST_RUNS_DIR: process.env.HOST_RUNS_DIR,
    WORKSPACE_RECLAIM: process.env.WORKSPACE_RECLAIM,
    WORKSPACE_STORE_MAX_MIB: process.env.WORKSPACE_STORE_MAX_MIB,
    WORKSPACE_IDLE_TTL_MS: process.env.WORKSPACE_IDLE_TTL_MS,
    WORKSPACE_ARCHIVED_TTL_MS: process.env.WORKSPACE_ARCHIVED_TTL_MS,
  };
  process.env.RUNS_DIR = dir;
  process.env.HOST_RUNS_DIR = dir;
  process.env.WORKSPACE_RECLAIM = "1";
  process.env.WORKSPACE_STORE_MAX_MIB = "0";
  process.env.WORKSPACE_IDLE_TTL_MS = "1000";
  process.env.WORKSPACE_ARCHIVED_TTL_MS = "1000";
  try {
    const old = "2026-01-01T00:00:00.000Z";
    const archived = sampleRun("run-old", "ARCHIVED", old);
    const live = sampleRun("run-live", "RUNNING", old);
    writeWorkspace("run-old", "notes.md", 32);
    writeWorkspace("run-live", "notes.md", 32);
    const result = reclaimPersistedWorkspaces({
      runs: [archived, live],
      protectedIds: new Set(["run-live"]),
      now: Date.parse("2026-01-10T00:00:00.000Z"),
    });
    assert.deepEqual(result.evicted.map((item) => item.runId), ["run-old"]);
    assert.equal(loadWorkspaceMeta("run-old")?.state, "evicted");
    assert.equal(loadWorkspaceMeta("run-old")?.evictedReason, "ttl");
    assert.equal(loadWorkspaceMeta("run-live")?.state, "present");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("reclaim drops the oldest idle workspace when the store is over budget", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-ws-budget-"));
  const previous = {
    RUNS_DIR: process.env.RUNS_DIR,
    HOST_RUNS_DIR: process.env.HOST_RUNS_DIR,
    WORKSPACE_RECLAIM: process.env.WORKSPACE_RECLAIM,
    WORKSPACE_STORE_MAX_MIB: process.env.WORKSPACE_STORE_MAX_MIB,
    WORKSPACE_IDLE_TTL_MS: process.env.WORKSPACE_IDLE_TTL_MS,
    WORKSPACE_ARCHIVED_TTL_MS: process.env.WORKSPACE_ARCHIVED_TTL_MS,
    WORKSPACE_PERSIST_MAX_MIB: process.env.WORKSPACE_PERSIST_MAX_MIB,
  };
  process.env.RUNS_DIR = dir;
  process.env.HOST_RUNS_DIR = dir;
  process.env.WORKSPACE_RECLAIM = "1";
  process.env.WORKSPACE_STORE_MAX_MIB = "0.00003";
  process.env.WORKSPACE_IDLE_TTL_MS = "0";
  process.env.WORKSPACE_ARCHIVED_TTL_MS = "0";
  process.env.WORKSPACE_PERSIST_MAX_MIB = "1";
  try {
    const older = sampleRun("run-a", "IDLE", "2026-01-01T00:00:00.000Z");
    const newer = sampleRun("run-b", "IDLE", "2026-01-02T00:00:00.000Z");
    writeWorkspace("run-a", "a.bin", 20);
    writeWorkspace("run-b", "b.bin", 20);
    const result = reclaimPersistedWorkspaces({
      runs: [older, newer],
      protectedIds: new Set(),
      now: Date.parse("2026-01-03T00:00:00.000Z"),
    });
    assert.ok(result.evicted.some((item) => item.runId === "run-a" && item.reason === "budget"));
    assert.equal(result.evicted.some((item) => item.runId === "run-b"), false);
    assert.equal(loadWorkspaceMeta("run-a")?.state, "evicted");
    assert.equal(loadWorkspaceMeta("run-b")?.state, "present");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("evictHostWorkspace clears files and keeps evicted metadata", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-ws-evict-"));
  const previous = {
    RUNS_DIR: process.env.RUNS_DIR,
    HOST_RUNS_DIR: process.env.HOST_RUNS_DIR,
  };
  process.env.RUNS_DIR = dir;
  process.env.HOST_RUNS_DIR = dir;
  try {
    writeWorkspace("run-gone", "keep.md", 8);
    evictHostWorkspace("run-gone", "budget", "2026-01-04T00:00:00.000Z");
    assert.equal(loadWorkspaceMeta("run-gone")?.state, "evicted");
    assert.equal(loadWorkspaceMeta("run-gone")?.evictedReason, "budget");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

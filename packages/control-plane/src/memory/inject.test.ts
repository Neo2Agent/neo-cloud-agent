import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts";
import { setMem0FetchForTests } from "./client.js";
import { writeRecalledMemory } from "./inject.js";

function sampleRun(id: string, prompt: string): Run {
  const createdAt = "2026-08-31T00:00:00.000Z";
  return {
    id,
    orgId: "org_local",
    userId: "user_local",
    envId: null,
    envVersionId: null,
    buildId: null,
    status: "NOT_YET_STARTED",
    setupStatus: null,
    source: "api",
    model: "neo/deepseek",
    prompt,
    branchName: null,
    baseBranch: null,
    repoUrls: [],
    pullRequests: [],
    workerHandle: null,
    createdAt,
    updatedAt: createdAt,
    idleAt: null,
    expiresAt: null,
    errorMessage: null,
  };
}

test("writeRecalledMemory writes MEMORY.md from search hits", async () => {
  const previousDir = process.env.RUNS_DIR;
  const previousUrl = process.env.MEM0_URL;
  const previousKey = process.env.MEM0_API_KEY;
  const previousRuntime = process.env.WORKER_RUNTIME;
  process.env.WORKER_RUNTIME = "none";
  process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-mem-inject-"));
  process.env.MEM0_URL = "http://mem0.test";
  process.env.MEM0_API_KEY = "m0sk_test";
  setMem0FetchForTests(async () =>
    new Response(JSON.stringify({ results: [{ id: "m1", memory: "用 pnpm" }] }), { status: 200 }),
  );
  try {
    await writeRecalledMemory(sampleRun("run_mem", "包管理器是什么"));
    const text = readFileSync(path.join(process.env.RUNS_DIR, "run_mem", ".neo", "MEMORY.md"), "utf8");
    assert.match(text, /用 pnpm/);
  } finally {
    setMem0FetchForTests(null);
    if (previousDir === undefined) delete process.env.RUNS_DIR;
    else process.env.RUNS_DIR = previousDir;
    if (previousUrl === undefined) delete process.env.MEM0_URL;
    else process.env.MEM0_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MEM0_API_KEY;
    else process.env.MEM0_API_KEY = previousKey;
    if (previousRuntime === undefined) delete process.env.WORKER_RUNTIME;
    else process.env.WORKER_RUNTIME = previousRuntime;
  }
});

test("writeRecalledMemory no-ops when Mem0 is not configured", async () => {
  const previousDir = process.env.RUNS_DIR;
  const previousUrl = process.env.MEM0_URL;
  const previousKey = process.env.MEM0_API_KEY;
  const previousRuntime = process.env.WORKER_RUNTIME;
  process.env.WORKER_RUNTIME = "none";
  process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-mem-skip-"));
  delete process.env.MEM0_URL;
  delete process.env.MEM0_API_KEY;
  try {
    await writeRecalledMemory(sampleRun("run_skip", "包管理器是什么"));
    assert.throws(() => readFileSync(path.join(process.env.RUNS_DIR!, "run_skip", ".neo", "MEMORY.md"), "utf8"));
  } finally {
    if (previousDir === undefined) delete process.env.RUNS_DIR;
    else process.env.RUNS_DIR = previousDir;
    if (previousUrl === undefined) delete process.env.MEM0_URL;
    else process.env.MEM0_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MEM0_API_KEY;
    else process.env.MEM0_API_KEY = previousKey;
    if (previousRuntime === undefined) delete process.env.WORKER_RUNTIME;
    else process.env.WORKER_RUNTIME = previousRuntime;
  }
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCloudTools, CLOUD_TOOL_NAMES } from "./tools.js";
import type { CloudToolContext, CloudToolFetch } from "./types.js";

function mockFetch(routes: Record<string, { status?: number; body: unknown }>): CloudToolFetch {
  return async (input) => {
    const url = String(input);
    const match = Object.entries(routes).find(([key]) => url.endsWith(key) || url.includes(key));
    if (!match) {
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }
    return new Response(JSON.stringify(match[1].body), {
      status: match[1].status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function ctx(fetchImpl: CloudToolFetch, workspaceDir = mkdtempSync(path.join(tmpdir(), "neo-ext-"))): CloudToolContext {
  return {
    runId: "run_1",
    controlPlaneUrl: "http://control.local",
    jwt: "neo.jwt",
    workspaceDir,
    fetch: fetchImpl,
  };
}

test("createCloudTools exposes commit, PR, and diagnostics", () => {
  const tools = createCloudTools(ctx(mockFetch({})));
  assert.deepEqual(
    tools.map((item) => item.name),
    [...CLOUD_TOOL_NAMES],
  );
});

test("neo_git_commit posts to the control plane and reports the sha", async () => {
  const tool = createCloudTools(
    ctx(
      mockFetch({
        "/internal/runs/run_1/scm/commit": {
          status: 201,
          body: { sha: "abc123", branch: "neo/demo", empty: false, message: "feat: x" },
        },
      }),
    ),
  ).find((item) => item.name === "neo_git_commit");
  assert.ok(tool);
  const result = await tool.execute({ message: "feat: x" });
  assert.equal(result.isError, undefined);
  assert.match(result.content, /abc123/);
  assert.match(result.content, /neo\/demo/);
});

test("neo_git_commit requires a message", async () => {
  const tool = createCloudTools(ctx(mockFetch({}))).find((item) => item.name === "neo_git_commit");
  const result = await tool!.execute({ message: "  " });
  assert.equal(result.isError, true);
  assert.match(result.content, /required/i);
});

test("neo_pr_open opens a draft pull request through the control plane", async () => {
  const tool = createCloudTools(
    ctx(
      mockFetch({
        "/internal/runs/run_1/scm/pull-request": {
          status: 201,
          body: {
            pushed: true,
            pullRequest: {
              url: "https://github.com/acme/app/pull/3",
              number: 3,
              title: "Ship it",
              draft: true,
              branch: "neo/demo",
            },
          },
        },
      }),
    ),
  ).find((item) => item.name === "neo_pr_open");
  const result = await tool!.execute({ title: "Ship it", body: "done" });
  assert.equal(result.isError, undefined);
  assert.match(result.content, /https:\/\/github.com\/acme\/app\/pull\/3/);
  assert.equal(result.details?.draft, true);
});

test("neo_diag merges control-plane events with local setup logs", async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "neo-diag-"));
  mkdirSync(path.join(workspaceDir, ".neo", "logs"), { recursive: true });
  writeFileSync(path.join(workspaceDir, ".neo", "logs", "start.log"), "dockerd ready\n");
  const tool = createCloudTools(
    ctx(
      mockFetch({
        "/internal/runs/run_1/diagnostics": {
          body: {
            run: {
              id: "run_1",
              status: "IDLE",
              setupStatus: "START_SUCCEEDED",
              envId: "env_1",
              envVersionId: "ver_1",
              buildId: "bld_1",
              branchName: "neo/demo",
              baseBranch: "main",
              model: "neo/deepseek",
              errorMessage: null,
              repoUrls: ["fixtures/toy-repo"],
            },
            environment: { id: "env_1", name: "toy", environmentJsonPath: ".neo/environment.json" },
            build: { id: "bld_1", status: "SUCCEEDED", draft: false, fingerprint: "fp", envVersionId: "ver_1" },
            egress: { mode: "allowlist_only", domains: ["example.com"] },
            events: [
              {
                id: "e1",
                runId: "run_1",
                createdAt: new Date().toISOString(),
                category: "agent_setup",
                level: "error",
                kind: "egress.denied",
                title: "Blocked outbound host evil.test",
              },
              {
                id: "e2",
                runId: "run_1",
                createdAt: new Date().toISOString(),
                category: "agent_setup",
                level: "info",
                kind: "run.start_succeeded",
                title: "Environment start finished",
              },
            ],
            logs: [],
          },
        },
      }),
      workspaceDir,
    ),
  ).find((item) => item.name === "neo_diag");
  const result = await tool!.execute({ section: "all" });
  assert.equal(result.isError, undefined);
  assert.match(result.content, /envId: env_1/);
  assert.match(result.content, /Blocked outbound host evil.test/);
  assert.match(result.content, /dockerd ready/);
  assert.match(result.content, /allowlist_only/);
});

test("neo_diag falls back to local logs when the control plane is down", async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "neo-diag-local-"));
  mkdirSync(path.join(workspaceDir, ".neo", "logs"), { recursive: true });
  writeFileSync(path.join(workspaceDir, ".neo", "logs", "start.log"), "local only\n");
  const tool = createCloudTools(
    ctx(async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }), workspaceDir),
  ).find((item) => item.name === "neo_diag");
  const result = await tool!.execute({});
  assert.equal(result.isError, undefined);
  assert.match(result.content, /local only/);
  assert.match(result.content, /unavailable/);
});

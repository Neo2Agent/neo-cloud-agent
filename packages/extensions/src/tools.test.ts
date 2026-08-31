import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCloudTools, CLOUD_TOOL_NAMES } from "./tools.js";
import { availableSubagents } from "./neo-subagent.js";
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

test("neo_artifact_upload posts a workspace file to the control plane", async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "neo-art-"));
  writeFileSync(path.join(workspaceDir, "notes.txt"), "hello artifact\n");
  const tool = createCloudTools(
    ctx(
      mockFetch({
        "/internal/runs/run_1/artifacts": {
          status: 201,
          body: { name: "notes.txt", url: "/v1/runs/run_1/artifacts/notes.txt", contentType: "text/plain", sizeBytes: 15 },
        },
      }),
      workspaceDir,
    ),
  ).find((item) => item.name === "neo_artifact_upload");
  const result = await tool!.execute({ path: "notes.txt" });
  assert.equal(result.isError, undefined);
  assert.match(result.content, /notes\.txt/);
  assert.equal(result.details?.url, "/v1/runs/run_1/artifacts/notes.txt");
});

test("neo_artifact_upload rejects a path outside the workspace", async () => {
  const tool = createCloudTools(ctx(mockFetch({}))).find((item) => item.name === "neo_artifact_upload");
  const result = await tool!.execute({ path: "../secret" });
  assert.equal(result.isError, true);
  assert.match(result.content, /escapes/i);
});

test("neo_browse extracts title and text after an egress check", async () => {
  const tool = createCloudTools(
    ctx(async (input) => {
      const url = String(input);
      if (url.includes("egress-check")) {
        return new Response(JSON.stringify({ allow: true }), { status: 200 });
      }
      return new Response("<html><title>Docs</title><p>Hello <b>world</b></p></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }),
  ).find((item) => item.name === "neo_browse");
  const result = await tool!.execute({ url: "https://example.com/docs" });
  assert.equal(result.isError, undefined);
  assert.match(result.content, /Docs/);
  assert.match(result.content, /Hello world/);
});

test("neo_browse honors an egress denial", async () => {
  const tool = createCloudTools(
    ctx(
      mockFetch({
        "/internal/runs/run_1/egress-check": { body: { allow: false, reason: "blocked evil.test" } },
      }),
    ),
  ).find((item) => item.name === "neo_browse");
  const result = await tool!.execute({ url: "https://evil.test" });
  assert.equal(result.isError, true);
  assert.match(result.content, /blocked evil.test/);
});

test("neo_mcp_list and neo_mcp_call talk to an HTTP MCP server", async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "neo-mcp-"));
  mkdirSync(path.join(workspaceDir, ".neo"), { recursive: true });
  writeFileSync(
    path.join(workspaceDir, ".neo/environment.json"),
    JSON.stringify({
      mcp: [{ name: "docs", transport: "http", url: "https://mcp.example/rpc" }],
    }),
  );
  const fetchImpl: CloudToolFetch = async (input, init) => {
    const url = String(input);
    if (!url.includes("mcp.example")) {
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
    if (body.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } }));
    }
    if (body.method === "tools/list") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "search", description: "Find docs" }] } }));
    }
    if (body.method === "tools/call") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "found it" }] } }));
    }
    return new Response(JSON.stringify({ error: body.method }), { status: 400 });
  };
  const tools = createCloudTools(ctx(fetchImpl, workspaceDir));
  const listed = await tools.find((item) => item.name === "neo_mcp_list")!.execute({});
  assert.match(listed.content, /docs/);
  assert.match(listed.content, /search/);
  const called = await tools.find((item) => item.name === "neo_mcp_call")!.execute({
    server: "docs",
    tool: "search",
    arguments: { q: "agent" },
  });
  assert.equal(called.isError, undefined);
  assert.match(called.content, /found it/);
});

test("neo_mcp_call prefers the control-plane HTTP proxy", async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "neo-mcp-cp-"));
  mkdirSync(path.join(workspaceDir, ".neo"), { recursive: true });
  writeFileSync(
    path.join(workspaceDir, ".neo/environment.json"),
    JSON.stringify({
      mcp: [{ name: "docs", transport: "http", url: "https://mcp.example/rpc" }],
    }),
  );
  const fetchImpl: CloudToolFetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/internal/runs/run_1/mcp")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
      if (body.action === "list") {
        return new Response(
          JSON.stringify({
            servers: [{ name: "docs", transport: "http", tools: [{ name: "search", description: "via control plane" }] }],
          }),
        );
      }
      return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "from control plane" }] } }));
    }
    return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 500 });
  };
  const tools = createCloudTools(ctx(fetchImpl, workspaceDir));
  const listed = await tools.find((item) => item.name === "neo_mcp_list")!.execute({});
  assert.match(listed.content, /via control plane/);
  const called = await tools.find((item) => item.name === "neo_mcp_call")!.execute({
    server: "docs",
    tool: "search",
  });
  assert.match(called.content, /from control plane/);
});

test("neo_subagent follows the pi single/parallel/chain contract", async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "neo-subagent-"));
  mkdirSync(path.join(workspaceDir, ".pi", "agents"), { recursive: true });
  writeFileSync(
    path.join(workspaceDir, ".pi/agents/auditor.md"),
    `---
name: auditor
description: Local security reviewer
tools: read, grep
---

Look for secrets.
`,
  );
  const names = availableSubagents(workspaceDir).map((item) => item.name);
  assert.ok(names.includes("scout"));
  assert.ok(names.includes("auditor"));
  const tool = createCloudTools(ctx(mockFetch({}), workspaceDir)).find((item) => item.name === "neo_subagent");
  assert.ok(tool);
  const bad = await tool.execute({ agent: "scout" });
  assert.equal(bad.isError, true);
  const missingRunner = await tool.execute({ agent: "scout", task: "find auth" });
  assert.equal(missingRunner.isError, true);
  assert.match(missingRunner.content, /worker session|scout/i);
  const ran = await createCloudTools({
    ...ctx(mockFetch({}), workspaceDir),
    runSubagent: async (params) => ({ content: `ran ${String(params.agent)}`, details: { agent: params.agent } }),
  })
    .find((item) => item.name === "neo_subagent")!
    .execute({ agent: "scout", task: "find auth" });
  assert.equal(ran.isError, undefined);
  assert.match(ran.content, /ran scout/);
});

test("availableSubagents reads scratch agents after workspace ones so the run wins", () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "neo-subagent-scratch-"));
  const scratchDir = path.join(workspaceDir, ".neo", "runs", "run-a");
  mkdirSync(path.join(workspaceDir, ".neo", "agents"), { recursive: true });
  mkdirSync(path.join(scratchDir, "agents"), { recursive: true });
  writeFileSync(
    path.join(workspaceDir, ".neo/agents/planner.md"),
    `---
name: planner
description: leftover workspace planner
---

Workspace leftover.
`,
  );
  writeFileSync(
    path.join(scratchDir, "agents/planner.md"),
    `---
name: planner
description: this run's planner
---

Scratch team member.
`,
  );
  const withoutScratch = availableSubagents(workspaceDir).find((item) => item.name === "planner");
  assert.match(withoutScratch?.systemPrompt ?? "", /Workspace leftover/);
  const withScratch = availableSubagents(workspaceDir, scratchDir).find((item) => item.name === "planner");
  assert.match(withScratch?.systemPrompt ?? "", /Scratch team member/);
});

test("neo_memory_add and neo_memory_search post to the control plane", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const tools = createCloudTools(
    ctx(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/internal/runs/run_1/memories") && init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as { action?: string; text?: string; query?: string };
        if (body.action === "add") {
          return new Response(JSON.stringify({ memories: [{ id: "m1", text: body.text }] }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ memories: [{ id: "m1", text: "用 pnpm" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }),
  );
  const add = tools.find((item) => item.name === "neo_memory_add");
  const search = tools.find((item) => item.name === "neo_memory_search");
  assert.ok(add);
  assert.ok(search);

  const saved = await add.execute({ text: "用 pnpm，不要 force push" });
  assert.equal(saved.isError, undefined);
  assert.match(saved.content, /Saved to user memory/);
  assert.match(saved.content, /用 pnpm/);
  const addBody = JSON.parse(String(calls[0]?.init?.body ?? "{}")) as { action?: string; text?: string };
  assert.equal(addBody.action, "add");
  assert.equal(addBody.text, "用 pnpm，不要 force push");

  const found = await search.execute({ query: "包管理器" });
  assert.equal(found.isError, undefined);
  assert.match(found.content, /用 pnpm/);
  const searchBody = JSON.parse(String(calls[1]?.init?.body ?? "{}")) as { action?: string; query?: string };
  assert.equal(searchBody.action, "search");
  assert.equal(searchBody.query, "包管理器");
});

test("neo_memory_add requires text", async () => {
  const tool = createCloudTools(ctx(mockFetch({}))).find((item) => item.name === "neo_memory_add");
  const result = await tool!.execute({ text: "  " });
  assert.equal(result.isError, true);
  assert.match(result.content, /required/i);
});

test("neo_subscribe posts events to the control plane", async () => {
  const tool = createCloudTools(
    ctx(
      mockFetch({
        "/internal/runs/run_1/subscriptions": {
          status: 201,
          body: {
            created: [
              {
                id: "sub-1",
                kind: "github_pr",
                repo: "acme/app",
                prNumber: 3,
                branch: "cursor/fix",
              },
            ],
            webhook: { path: "/webhooks/github", configured: true },
          },
        },
      }),
    ),
  ).find((item) => item.name === "neo_subscribe");
  assert.ok(tool);
  const result = await tool.execute({ events: ["pr_activity"] });
  assert.equal(result.isError, undefined);
  assert.match(result.content, /PR activity/);
  assert.match(result.content, /acme\/app#3/);
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

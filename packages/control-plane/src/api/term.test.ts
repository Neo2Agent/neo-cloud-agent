import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "term-secret";
process.env.CONTROL_PLANE_TOKEN = "term-api-token";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-term-api-"));
delete process.env.WORKER_WORKSPACE_MOUNT;
process.env.ACCOUNTS_REQUIRED = "0";
process.env.OBJECT_STORE = "memory";
process.env.DATABASE_URL = "";
process.env.REDIS_URL = "";
process.env.MEM0_URL = "";
process.env.MEM0_API_KEY = "";
process.env.BUILD_CAPTURE = "0";

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");
const { createRun } = await import("../orchestrator/orchestrator.js");
const { attachWorkspaceTermStream, onWorkspaceTermEvent, resetWorkspaceShellsForTests } = await import(
  "../runtime/workspace-shell.js"
);

function auth(headers: Record<string, string> = {}): Record<string, string> {
  return { authorization: "Bearer term-api-token", ...headers };
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("timed out waiting for term output");
}

test("workspace term is a typed shell, not setup logs", async (t) => {
  resetWorkspaceShellsForTests();
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    resetWorkspaceShellsForTests();
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  const run = await createRun({ prompt: "open a shell", repoUrls: [] });

  const denied = await fetch(`${base}/v1/runs/${run.id}/term`);
  assert.equal(denied.status, 401);

  const opened = await fetch(`${base}/v1/runs/${run.id}/term`, {
    method: "POST",
    headers: auth({ "content-type": "application/json" }),
  });
  assert.equal(opened.status, 201);
  const session = (await opened.json()) as {
    id: string;
    cwd: string;
    shell: string;
    alive: boolean;
    pty?: boolean;
  };
  assert.ok(session.id);
  assert.equal(session.alive, true);
  assert.match(session.shell, /zsh|bash|sh/);
  assert.equal(typeof session.pty, "boolean");

  const listed = await fetch(`${base}/v1/runs/${run.id}/term`, { headers: auth() });
  assert.equal(listed.status, 200);
  const listing = (await listed.json()) as { sessions: Array<{ id: string }> };
  assert.equal(listing.sessions.some((item) => item.id === session.id), true);

  const chunks: string[] = [];
  const stop = onWorkspaceTermEvent(session.id, (event) => {
    if (event.type === "data") {
      chunks.push(event.chunk);
    }
  });
  t.after(stop);

  const written = await fetch(`${base}/v1/runs/${run.id}/term/${session.id}`, {
    method: "POST",
    headers: auth({ "content-type": "application/json" }),
    body: JSON.stringify({ data: "printf 'from-web-term\\n'\n" }),
  });
  assert.equal(written.status, 200);
  await waitFor(() => chunks.join("").includes("from-web-term"));

  const other = await createRun({ prompt: "other", repoUrls: [] });
  const stolen = await fetch(`${base}/v1/runs/${other.id}/term/${session.id}`, {
    method: "POST",
    headers: auth({ "content-type": "application/json" }),
    body: JSON.stringify({ data: "echo no\n" }),
  });
  assert.equal(stolen.status, 404);

  const closed = await fetch(`${base}/v1/runs/${run.id}/term/${session.id}`, {
    method: "DELETE",
    headers: auth(),
  });
  assert.equal(closed.status, 200);
});

test("term SSE replays the buffer then live chunks", async (t) => {
  resetWorkspaceShellsForTests();
  const { openWorkspaceTerm, writeWorkspaceTerm } = await import("../runtime/workspace-shell.js");
  const cwd = mkdtempSync(path.join(tmpdir(), "neo-term-sse-"));
  const opened = openWorkspaceTerm({ runId: "run_sse", cwd });
  t.after(() => resetWorkspaceShellsForTests());

  const chunks: string[] = [];
  const req = new EventEmitter() as IncomingMessage;
  const res = new EventEmitter() as ServerResponse;
  res.writeHead = (() => res) as ServerResponse["writeHead"];
  res.write = ((chunk: string) => {
    chunks.push(String(chunk));
    return true;
  }) as ServerResponse["write"];

  attachWorkspaceTermStream(req, res, "run_sse", opened.id);
  assert.match(chunks.join(""), /"type":"ready"/);
  assert.match(chunks.join(""), new RegExp(opened.id));

  writeWorkspaceTerm("run_sse", opened.id, "printf 'sse-live\\n'\n");
  await waitFor(() => chunks.join("").includes("sse-live"));
  req.emit("close");
});

import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
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
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");
const { createRun } = await import("../orchestrator/orchestrator.js");
const { resetWorkspaceShellsForTests } = await import("../runtime/workspace-shell.js");

function auth(headers: http.OutgoingHttpHeaders = {}): http.OutgoingHttpHeaders {
  return { authorization: "Bearer term-api-token", ...headers };
}

function attachTermSse(url: string) {
  const events: Array<{ type?: string; chunk?: string; code?: number | null }> = [];
  let buffer = "";
  const request = http.get(
    url,
    { headers: { accept: "text/event-stream", authorization: "Bearer term-api-token" } },
    (response) => {
      response.on("data", (chunk) => {
        buffer += String(chunk);
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((item) => item.startsWith("data: "));
          if (line) {
            events.push(JSON.parse(line.slice(6)) as { type?: string; chunk?: string });
          }
        }
      });
    },
  );
  return {
    events,
    close() {
      request.destroy();
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("timed out waiting for term SSE");
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
  const run = await createRun({ prompt: "open a shell", repoUrls: ["fixtures/toy-repo"] });

  const denied = await fetch(`${base}/v1/runs/${run.id}/term`);
  assert.equal(denied.status, 401);

  const opened = await fetch(`${base}/v1/runs/${run.id}/term`, {
    method: "POST",
    headers: auth({ "content-type": "application/json" }),
  });
  assert.equal(opened.status, 201);
  const session = (await opened.json()) as { id: string; cwd: string; shell: string; alive: boolean };
  assert.ok(session.id);
  assert.equal(session.alive, true);
  assert.match(session.shell, /zsh|bash|sh/);

  const listed = await fetch(`${base}/v1/runs/${run.id}/term`, { headers: auth() });
  assert.equal(listed.status, 200);
  const listing = (await listed.json()) as { sessions: Array<{ id: string }> };
  assert.equal(listing.sessions.some((item) => item.id === session.id), true);

  const stream = attachTermSse(`${base}/v1/runs/${run.id}/term/${session.id}/events`);
  t.after(() => stream.close());
  await waitFor(() => stream.events.some((item) => item.type === "ready"));

  const written = await fetch(`${base}/v1/runs/${run.id}/term/${session.id}`, {
    method: "POST",
    headers: auth({ "content-type": "application/json" }),
    body: JSON.stringify({ data: "printf 'from-web-term\\n'\n" }),
  });
  assert.equal(written.status, 200);
  await waitFor(() => stream.events.some((item) => (item.chunk ?? "").includes("from-web-term")));

  const other = await createRun({ prompt: "other", repoUrls: ["fixtures/toy-repo"] });
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

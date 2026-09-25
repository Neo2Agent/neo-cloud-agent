import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Project, Run } from "@neo-cloud-agent/contracts";
import { RUN_LIST_CHANGED_KIND, type UserListEvent } from "@neo-cloud-agent/contracts/client-stream";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "list-stream-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-list-stream-"));
process.env.ACCOUNTS_REQUIRED = "1";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.CONTROL_PLANE_AUTH;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.BOOTSTRAP_EMAIL;
delete process.env.BOOTSTRAP_PASSWORD;

const { createApiServer } = await import("./server.js");
const { ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { listen, close } = await import("../e2e/helpers.js");

async function login(base: string, email: string, password: string): Promise<{ token: string; user: { id: string } }> {
  const response = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { token?: string; user?: { id: string }; error?: string };
  assert.equal(response.status, 200, body.error ?? "login failed");
  assert.ok(body.token && body.user);
  return { token: body.token, user: body.user };
}

function auth(token: string): { "content-type": string; authorization: string } {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

function attachListSse(url: string) {
  const events: UserListEvent[] = [];
  let buffer = "";
  const request = http.get(url, { headers: { accept: "text/event-stream" } }, (response) => {
    response.on("data", (chunk) => {
      buffer += String(chunk);
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((item) => item.startsWith("data: "));
        if (line) {
          events.push(JSON.parse(line.slice(6)) as UserListEvent);
        }
      }
    });
  });
  return {
    events,
    close() {
      request.destroy();
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for list SSE");
}

test("GET /v1/me/events pushes runs.changed when a visible run is created", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();
  const admin = await login(base, "admin", "123456");
  const stream = attachListSse(`${base}/v1/me/events?access_token=${admin.token}`);
  t.after(() => stream.close());

  const created = await fetch(`${base}/v1/projects`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ name: "列表推送", instruction: "看列表" }),
  });
  const project = (await created.json()) as Project;
  const runRes = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ prompt: "新对话进列表", repoUrls: ["fixtures/toy-repo"], projectId: project.id }),
  });
  assert.equal(runRes.status, 201);
  const run = (await runRes.json()) as Run;
  await waitFor(() => stream.events.some((item) => item.kind === RUN_LIST_CHANGED_KIND && item.data?.runId === run.id));
});

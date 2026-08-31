import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "runs-delete-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-runs-delete-"));
process.env.ACCOUNTS_REQUIRED = "1";
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { archiveRunArtifacts } = await import("../objects/archive.js");
const { listen, close } = await import("../e2e/helpers.js");

test("DELETE /v1/runs/:id only soft-deletes archived runs", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();
  const login = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin", password: "123456" }),
  });
  const session = (await login.json()) as { token: string };
  const headers = { "content-type": "application/json", authorization: `Bearer ${session.token}` };

  const created = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: "to delete", repoUrls: ["fixtures/toy-repo"] }),
  });
  assert.equal(created.status, 201);
  const run = (await created.json()) as { id: string };

  const tooSoon = await fetch(`${base}/v1/runs/${run.id}`, { method: "DELETE", headers });
  assert.equal(tooSoon.status, 409);

  const archived = await fetch(`${base}/v1/runs/${run.id}/archive`, { method: "POST", headers });
  assert.equal(archived.status, 200);
  // Object-store snapshot is what used to resurrect the run on GET.
  await archiveRunArtifacts(run.id);

  const deleted = await fetch(`${base}/v1/runs/${run.id}`, { method: "DELETE", headers });
  assert.equal(deleted.status, 200);
  const body = (await deleted.json()) as { ok: boolean; id: string; deletedAt: string };
  assert.equal(body.ok, true);
  assert.equal(body.id, run.id);
  assert.ok(body.deletedAt);

  const listed = await fetch(`${base}/v1/runs`, { headers });
  const runs = (await listed.json()) as { runs: Array<{ id: string }> };
  assert.equal(runs.runs.some((item) => item.id === run.id), false);

  const missing = await fetch(`${base}/v1/runs/${run.id}`, { headers });
  assert.equal(missing.status, 404);
});

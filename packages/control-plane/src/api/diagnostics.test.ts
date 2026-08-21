import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "diag-secret";
process.env.CONTROL_PLANE_TOKEN = "diag-api-token";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-diag-api-"));
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.ACCOUNTS_REQUIRED;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");
const { mintRunToken } = await import("@neo-cloud-agent/contracts");
const { createRun, getBootstrap } = await import("../orchestrator/orchestrator.js");

test("worker JWT can read diagnostics; public API needs the control-plane token", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  const run = await createRun({ prompt: "wire extensions", repoUrls: ["fixtures/toy-repo"] });
  const workspace = getBootstrap(run.id).workspaceDir;
  mkdirSync(path.join(workspace, ".neo", "logs"), { recursive: true });
  writeFileSync(path.join(workspace, ".neo", "logs", "start.log"), "ready\n");

  const denied = await fetch(`${base}/internal/runs/${run.id}/diagnostics`);
  assert.equal(denied.status, 401);

  const otherRun = mintRunToken("diag-secret", {
    sub: "worker",
    runId: "not-this-run",
    orgId: "org_local",
    model: "neo/deepseek",
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "diag-wrong",
  });
  const mismatched = await fetch(`${base}/internal/runs/${run.id}/diagnostics`, {
    headers: { authorization: `Bearer ${otherRun}` },
  });
  assert.equal(mismatched.status, 401);

  const jwt = mintRunToken("diag-secret", {
    sub: "worker",
    runId: run.id,
    orgId: "org_local",
    model: "neo/deepseek",
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "diag-test",
  });
  const internal = await fetch(`${base}/internal/runs/${run.id}/diagnostics`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  assert.equal(internal.status, 200);
  const body = (await internal.json()) as {
    run: { id: string; setupStatus: string | null };
    events: Array<{ kind: string }>;
    logs: Array<{ name: string; content: string }>;
    egress: { mode: string };
  };
  assert.equal(body.run.id, run.id);
  assert.equal(body.run.setupStatus, "INSTALL_SUCCEEDED");
  assert.equal(body.egress.mode, "allow_all");
  assert.ok(body.events.some((item) => item.kind === "run.install_succeeded"));
  assert.ok(body.logs.some((item) => item.name === "start.log" && item.content.includes("ready")));

  const publicDenied = await fetch(`${base}/v1/runs/${run.id}/diagnostics`);
  assert.equal(publicDenied.status, 401);
  const publicDiag = await fetch(`${base}/v1/runs/${run.id}/diagnostics`, {
    headers: { authorization: "Bearer diag-api-token" },
  });
  assert.equal(publicDiag.status, 200);
});

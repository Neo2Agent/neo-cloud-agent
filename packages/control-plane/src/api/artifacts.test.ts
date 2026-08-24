import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "art-secret";
process.env.CONTROL_PLANE_TOKEN = "art-api-token";
process.env.OBJECT_STORE = "memory";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-art-api-"));
delete process.env.WORKER_WORKSPACE_MOUNT;
process.env.ACCOUNTS_REQUIRED = "0";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");
const { mintRunToken } = await import("@neo-cloud-agent/contracts");
const { createRun } = await import("../orchestrator/orchestrator.js");

test("worker JWT can upload an artifact; the chat API can download it", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  const run = await createRun({ prompt: "attach a log", repoUrls: ["fixtures/toy-repo"] });
  const jwt = mintRunToken("art-secret", {
    sub: "worker",
    runId: run.id,
    orgId: "org_local",
    model: "neo/deepseek",
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "art-test",
  });

  const denied = await fetch(`${base}/internal/runs/${run.id}/artifacts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "out.log", content: "boom" }),
  });
  assert.equal(denied.status, 401);

  const uploaded = await fetch(`${base}/internal/runs/${run.id}/artifacts`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "out.log", content: "boom\n", contentType: "text/plain; charset=utf-8" }),
  });
  assert.equal(uploaded.status, 201);
  const body = (await uploaded.json()) as { name: string; url: string };
  assert.equal(body.name, "out.log");

  const listed = await fetch(`${base}/v1/runs/${run.id}/artifacts`, {
    headers: { authorization: "Bearer art-api-token" },
  });
  assert.equal(listed.status, 200);
  const catalog = (await listed.json()) as { artifacts: Array<{ name: string }> };
  assert.ok(catalog.artifacts.some((item) => item.name === "out.log"));

  const file = await fetch(`${base}/v1/runs/${run.id}/artifacts/out.log`, {
    headers: { authorization: "Bearer art-api-token" },
  });
  assert.equal(file.status, 200);
  assert.equal(await file.text(), "boom\n");

  const { signArtifactAccess } = await import("../artifacts/signed.js");
  const token = signArtifactAccess(run.id, "out.log");
  const signed = await fetch(`${base}/v1/runs/${run.id}/artifacts/out.log?token=${token}`);
  assert.equal(signed.status, 200);
  assert.equal(await signed.text(), "boom\n");
  const deniedFile = await fetch(`${base}/v1/runs/${run.id}/artifacts/out.log?token=nope`);
  assert.equal(deniedFile.status, 401);
});

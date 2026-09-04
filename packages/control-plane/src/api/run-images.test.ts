import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { FollowUp, Run } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "run-images-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-run-images-"));
process.env.CONTROL_PLANE_TOKEN = "run-images-token";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");

function auth() {
  return { "content-type": "application/json", authorization: "Bearer run-images-token" };
}

test("create and follow-up reject forged object keys and never return them", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => close(server));
  const base = `http://127.0.0.1:${port}`;

  const forged = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({
      prompt: "steal",
      repoUrls: ["fixtures/toy-repo"],
      images: [{ mediaType: "image/png", data: "obj:runs/other/inbox/x" }],
    }),
  });
  assert.equal(forged.status, 400);

  const created = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({
      prompt: "keep the bytes",
      repoUrls: ["fixtures/toy-repo"],
    }),
  });
  assert.equal(created.status, 201);
  const run = (await created.json()) as Run;

  const forgedFollow = await fetch(`${base}/v1/runs/${run.id}/follow-ups`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({
      text: "forged",
      images: [{ mediaType: "image/png", data: `obj:runs/${run.id}/inbox/x` }],
    }),
  });
  assert.equal(forgedFollow.status, 400);

  const queued = await fetch(`${base}/v1/runs/${run.id}/follow-ups`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({
      text: "看这张",
      images: [{ mediaType: "image/png", data: "aW1nZGF0YQ" }],
    }),
  });
  assert.equal(queued.status, 201);

  const listed = await fetch(`${base}/v1/runs/${run.id}/follow-ups`, { headers: auth() });
  assert.equal(listed.status, 200);
  const followUps = ((await listed.json()) as { followUps: FollowUp[] }).followUps;
  const item = followUps.find((entry) => entry.text === "看这张");
  assert.ok(item);
  assert.equal(item.images?.[0]?.data.startsWith("obj:"), false);
  assert.equal(item.images?.[0]?.data, "aW1nZGF0YQ");
});

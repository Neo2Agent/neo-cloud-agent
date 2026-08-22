import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "webhook-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-webhooks-"));
process.env.GITHUB_WEBHOOK_SECRET = "github-hook-secret";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_TOKEN;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");
const { mintRunToken } = await import("@neo-cloud-agent/contracts");
const { createRun, listFollowUps } = await import("../orchestrator/orchestrator.js");

function sign(raw: string): string {
  return `sha256=${createHmac("sha256", "github-hook-secret").update(raw).digest("hex")}`;
}

test("GitHub webhook verifies the signature and wakes a subscribed run", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;

  const health = (await (await fetch(`${base}/health`)).json()) as {
    githubWebhook?: { path?: string; configured?: boolean };
  };
  assert.equal(health.githubWebhook?.path, "/webhooks/github");
  assert.equal(health.githubWebhook?.configured, true);

  const run = await createRun({ prompt: "watch the pr", repoUrls: ["fixtures/toy-repo"] });
  run.pullRequests.push({
    repoUrl: "https://github.com/acme/app",
    branch: run.branchName ?? "neo/watch",
    url: "https://github.com/acme/app/pull/3",
    draft: true,
    number: 3,
    title: "Watch me",
  });
  const jwt = mintRunToken("webhook-secret", {
    sub: "worker",
    runId: run.id,
    orgId: "org_local",
    model: "neo/deepseek",
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "webhook-test",
  });
  const created = await fetch(`${base}/internal/runs/${run.id}/subscriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ events: ["pr_activity", "ci"] }),
  });
  assert.equal(created.status, 201);
  const createdBody = (await created.json()) as { subscriptions?: unknown[] };
  assert.ok((createdBody.subscriptions?.length ?? 0) >= 2);

  const denied = await fetch(`${base}/webhooks/github`, {
    method: "POST",
    headers: { "x-github-event": "ping", "content-type": "application/json" },
    body: JSON.stringify({ zen: "nope" }),
  });
  assert.equal(denied.status, 401);

  const pingBody = JSON.stringify({ zen: "Design for failure." });
  const ping = await fetch(`${base}/webhooks/github`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "ping",
      "x-hub-signature-256": sign(pingBody),
    },
    body: pingBody,
  });
  assert.equal(ping.status, 200);

  const comment = JSON.stringify({
    action: "created",
    issue: { number: 3, pull_request: { url: "https://api.github.com/repos/acme/app/pulls/3" } },
    comment: {
      id: 4242,
      body: "please add a test",
      html_url: "https://github.com/acme/app/pull/3#issuecomment-4242",
      user: { login: "alice" },
    },
    repository: { full_name: "acme/app" },
    sender: { login: "alice" },
  });
  const delivered = await fetch(`${base}/webhooks/github`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issue_comment",
      "x-github-delivery": "deliv-comment",
      "x-hub-signature-256": sign(comment),
    },
    body: comment,
  });
  assert.equal(delivered.status, 202);
  const deliveredBody = (await delivered.json()) as { delivered?: number };
  assert.equal(deliveredBody.delivered, 1);
  const follows = listFollowUps(run.id);
  assert.equal(follows.some((item) => item.text.includes("please add a test")), true);
});

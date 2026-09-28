import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import type { Desk, Run } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.AGENT_KERNEL = "pi";
process.env.LLM_GATEWAY_JWT_SECRET = "rc-cloud-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-rc-cloud-api-"));
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
const { openDeskInbox } = await import("../desks/store.js");

async function login(base: string) {
  const response = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin", password: "123456" }),
  });
  const body = (await response.json()) as { token: string };
  assert.equal(response.status, 200);
  return body.token;
}

function auth(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

function initBranchRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-rc-src-"));
  spawnSync("git", ["init", "-b", "main"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "rc@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "RC"], { cwd: dir });
  writeFileSync(path.join(dir, "README.md"), "base\n");
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir });
  spawnSync("git", ["checkout", "-b", "feat/login"], { cwd: dir });
  writeFileSync(path.join(dir, "FEATURE.md"), "branch work\n");
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "feat"], { cwd: dir });
  return dir;
}

test("offline Remote Control handoff clones the recorded branch and stays the same run", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => close(server));
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();
  const token = await login(base);
  const repo = initBranchRepo();

  const registered = (await (
    await fetch(`${base}/v1/desks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ name: "Ada laptop", hostname: "ada", platform: "linux" }),
    })
  ).json()) as { desk: Desk; token: string };

  const created = await fetch(`${base}/v1/runs?client=desk`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      prompt: "remote then cloud",
      repoUrls: [repo],
      source: "desk",
      start: "inline",
      kernel: "agentscope",
      target: {
        loop: "cloud",
        tools: "desk",
        deskId: registered.desk.id,
        remoteControl: true,
      },
    }),
  });
  assert.equal(created.status, 201);
  const remote = (await created.json()) as Run;

  const claim = await fetch(`${base}/v1/desks/${registered.desk.id}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${registered.token}` },
    body: JSON.stringify({
      runId: remote.id,
      workspaceDir: repo,
      remoteUrl: "https://github.com/acme/app.git",
      branch: "feat/login",
    }),
  });
  assert.equal(claim.status, 200);
  const claimed = (await claim.json()) as Run;
  assert.equal(claimed.remoteUrl, "https://github.com/acme/app.git");
  assert.equal(claimed.baseBranch, "feat/login");

  const detach = openDeskInbox(registered.desk.id, () => undefined);
  const onlineHandoff = await fetch(`${base}/v1/runs/${remote.id}/handoff`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ target: { loop: "cloud", tools: "cloud" } }),
  });
  assert.equal(onlineHandoff.status, 400);
  assert.match(((await onlineHandoff.json()) as { error?: string }).error ?? "", /电脑在线时/);
  detach();

  const movedRes = await fetch(`${base}/v1/runs/${remote.id}/handoff`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ target: { loop: "cloud", tools: "cloud" } }),
  });
  const movedBody = await movedRes.text();
  assert.equal(movedRes.status, 200, movedBody);
  const moved = JSON.parse(movedBody) as Run;
  assert.equal(moved.id, remote.id);
  assert.equal(moved.executionTarget?.loop, "cloud");
  assert.equal(moved.executionTarget?.tools, "cloud");
  assert.equal(moved.executionTarget?.remoteControl, undefined);
  assert.equal(moved.branchName, "feat/login");
  assert.equal(moved.remoteUrl, "https://github.com/acme/app.git");

  const transcript = (await (
    await fetch(`${base}/v1/runs/${remote.id}/transcript`, { headers: auth(token) })
  ).json()) as { snapshot?: { messages?: Array<{ text?: string; kind?: string }> } };
  const setup = (transcript.snapshot?.messages ?? []).map((item) => item.text ?? "").join("\n");
  assert.match(setup, /正在按 acme\/app · feat\/login 在云端物化工作区/);
  assert.match(setup, /已转到云端 · 工作区就绪 · acme\/app · feat\/login · 未 push/);

  const follow = await fetch(`${base}/v1/runs/${remote.id}/follow-ups`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ text: "continue in the cloud" }),
  });
  assert.equal(follow.status, 201);

  const localRes = await fetch(`${base}/v1/runs?client=desk`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      prompt: "stay private",
      repoUrls: [repo],
      source: "desk",
      start: "inline",
      target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
    }),
  });
  const local = (await localRes.json()) as Run;
  const webList = (await (await fetch(`${base}/v1/runs`, { headers: auth(token) })).json()) as { runs: Run[] };
  assert.equal(
    webList.runs.some((item) => item.id === local.id),
    false,
  );
  assert.equal(
    webList.runs.some((item) => item.id === moved.id),
    true,
  );
});

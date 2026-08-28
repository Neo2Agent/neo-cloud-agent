import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Desk, Run } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "desk-vis-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-desk-vis-api-"));
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
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

function runsUrl(desk: boolean): string {
  return desk ? "/v1/runs?client=desk" : "/v1/runs";
}

test("This Computer stays off web; Remote Control is listed", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => close(server));
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();
  const token = await login(base);

  const registered = (await (
    await fetch(`${base}/v1/desks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ name: "Ada laptop", hostname: "ada", platform: "win32" }),
    })
  ).json()) as { desk: Desk };

  const localRes = await fetch(`${base}${runsUrl(true)}`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      prompt: "local only",
      repoUrls: ["C:\\Users\\ada\\app"],
      source: "desk",
      start: "inline",
      target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
    }),
  });
  assert.equal(localRes.status, 201);
  const local = (await localRes.json()) as Run;
  assert.equal(local.executionTarget?.remoteControl, undefined);

  const remoteRes = await fetch(`${base}${runsUrl(true)}`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      prompt: "visible remotely",
      repoUrls: ["C:\\Users\\ada\\app"],
      source: "desk",
      start: "inline",
      target: { loop: "desk", tools: "desk", deskId: registered.desk.id, remoteControl: true },
    }),
  });
  assert.equal(remoteRes.status, 201);
  const remote = (await remoteRes.json()) as Run;
  assert.equal(remote.executionTarget?.remoteControl, true);

  const webList = (await (await fetch(`${base}${runsUrl(false)}`, { headers: auth(token) })).json()) as { runs: Run[] };
  assert.equal(webList.runs.some((item) => item.id === local.id), false);
  assert.equal(webList.runs.some((item) => item.id === remote.id), true);
  assert.equal((await fetch(`${base}/v1/runs/${local.id}`, { headers: auth(token) })).status, 404);
  assert.equal((await fetch(`${base}/v1/runs/${remote.id}`, { headers: auth(token) })).status, 200);
  assert.equal(
    (
      await fetch(`${base}/v1/runs/${local.id}/follow-ups`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ text: "from the web" }),
      })
    ).status,
    404,
  );

  const deskList = (await (await fetch(`${base}${runsUrl(true)}`, { headers: auth(token) })).json()) as { runs: Run[] };
  assert.equal(deskList.runs.some((item) => item.id === local.id), true);
  assert.equal(deskList.runs.some((item) => item.id === remote.id), true);
  assert.equal((await fetch(`${base}/v1/runs/${local.id}?client=desk`, { headers: auth(token) })).status, 200);

  const offlineFollow = await fetch(`${base}/v1/runs/${remote.id}/follow-ups`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ text: "from the web while desk is down" }),
  });
  assert.equal(offlineFollow.status, 409);
  assert.match(((await offlineFollow.json()) as { error?: string }).error ?? "", /离线/);

  const { openDeskInbox } = await import("../desks/store.js");
  const detach = openDeskInbox(registered.desk.id, () => undefined);
  t.after(detach);
  const liveFollow = await fetch(`${base}/v1/runs/${remote.id}/follow-ups`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ text: "desk is back" }),
  });
  assert.equal(liveFollow.status, 201);
});

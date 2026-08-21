import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "env-api-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-env-api-"));
process.env.WARM_POOL_SIZE = "1";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.ACCOUNTS_REQUIRED;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");
const { createRun } = await import("../orchestrator/orchestrator.js");
const { listEvents } = await import("../events/bus.js");

test("environments and builds API create a snapshot that later runs reuse", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;

  const createdEnv = await (
    await fetch(`${base}/v1/environments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "toy", repoUrls: ["fixtures/toy-repo"] }),
    })
  ).json() as { id: string; name: string; config: { repos?: string[] } };
  assert.equal(createdEnv.name, "toy");
  assert.deepEqual(createdEnv.config.repos, ["fixtures/toy-repo"]);

  const listed = await (await fetch(`${base}/v1/environments`)).json() as { environments: Array<{ id: string }> };
  assert.equal(listed.environments.some((item) => item.id === createdEnv.id), true);

  const fetched = await (await fetch(`${base}/v1/environments/${createdEnv.id}`)).json() as { id: string };
  assert.equal(fetched.id, createdEnv.id);

  const build = await (
    await fetch(`${base}/v1/environments/${createdEnv.id}/builds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
  ).json() as { id: string; status: string; snapshotPath: string | null; envId: string; draft: boolean };
  assert.equal(build.status, "SUCCEEDED");
  assert.equal(build.envId, createdEnv.id);
  assert.equal(build.draft, false);
  assert.ok(build.snapshotPath);
  assert.equal(readFileSync(path.join(build.snapshotPath ?? "", ".neo-installed"), "utf8").trim(), "ok");

  const got = await (await fetch(`${base}/v1/builds/${build.id}`)).json() as { id: string; status: string };
  assert.equal(got.id, build.id);
  assert.equal(got.status, "SUCCEEDED");

  const logs = await (await fetch(`${base}/v1/builds/${build.id}/logs`)).json() as { logs: string };
  assert.match(logs.logs, /printf|materialize/);

  const builds = await (await fetch(`${base}/v1/builds`)).json() as { builds: Array<{ id: string }> };
  assert.equal(builds.builds.some((item) => item.id === build.id), true);

  const health = await (await fetch(`${base}/health`)).json() as { builds: number; warmPoolReady: number };
  assert.ok(health.builds >= 1);
  assert.ok(health.warmPoolReady >= 1);

  const run = await createRun({
    prompt: "boot from the API build",
    repoUrls: ["fixtures/toy-repo"],
    envId: createdEnv.id,
    buildId: build.id,
  });
  assert.equal(run.status, "RUNNING");
  assert.equal(run.buildId, build.id);
  assert.equal(run.setupStatus, "INSTALL_SUCCEEDED");
  assert.ok(listEvents(run.id).some((item) => item.kind === "build.used"));
  assert.equal(listEvents(run.id).some((item) => item.kind === "run.install_started"), false);
});

test("POST /v1/builds rejects an empty repo list", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => close(server));
  const res = await fetch(`http://127.0.0.1:${port}/v1/builds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

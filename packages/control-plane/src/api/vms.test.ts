import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "vm";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.VM_SLOT_COUNT = "2";
process.env.VM_SLOT_SKIP_MOUNT = "1";
process.env.VM_SLOTS_DIR = mkdtempSync(path.join(tmpdir(), "neo-vm-api-"));
process.env.LLM_GATEWAY_JWT_SECRET = "vm-secret";
process.env.CONTROL_PLANE_TOKEN = "vm-api-token";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-vm-runs-"));
delete process.env.WORKER_WORKSPACE_MOUNT;
process.env.ACCOUNTS_REQUIRED = "0";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");
const { ensureVmSlots } = await import("../runtime/vm-slots.js");

test("GET /v1/vms lists the loop-mounted slot pool", async (t) => {
  await ensureVmSlots();
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  const denied = await fetch(`${base}/v1/vms`);
  assert.equal(denied.status, 401);
  const listed = await fetch(`${base}/v1/vms`, { headers: { authorization: "Bearer vm-api-token" } });
  assert.equal(listed.status, 200);
  const body = (await listed.json()) as { total: number; backend: string; slots: unknown[] };
  assert.equal(body.total, 2);
  assert.equal(body.backend, "loop");
  assert.equal(body.slots.length, 2);
  const health = (await (await fetch(`${base}/health`)).json()) as { vmSlots: { total: number; backend: string } };
  assert.equal(health.vmSlots.total, 2);
  assert.equal(health.vmSlots.backend, "loop");
});

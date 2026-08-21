import assert from "node:assert/strict";
import test from "node:test";

process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "test-secret";

const { createRun, getBootstrap, takeInbound } = await import("./orchestrator.js");

test("createRun mints a bootstrap JWT and queues the first prompt", async () => {
  const run = await createRun({
    prompt: "list files",
    repoUrls: ["github.com/acme/toy"],
  });
  assert.equal(run.status, "RUNNING");
  const bootstrap = getBootstrap(run.id);
  assert.ok(bootstrap.jwt.split(".").length === 3);
  assert.equal(bootstrap.run.id, run.id);
  const inbox = takeInbound(run.id);
  const first = inbox[0];
  assert.ok(first);
  assert.equal(first.type, "prompt");
  assert.equal("text" in first ? first.text : "", "list files");
});

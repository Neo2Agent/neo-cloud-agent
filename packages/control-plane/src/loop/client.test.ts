import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts";
import { dispatchTurn } from "./client.js";

function fakeRun(): Run {
  return {
    id: "run-loop-1",
    orgId: "org",
    userId: "user",
    envId: null,
    envVersionId: null,
    buildId: null,
    status: "RUNNING",
    setupStatus: null,
    source: "api",
    kernel: "agentscope",
    model: "neo/deepseek",
    prompt: "hi",
    branchName: null,
    baseBranch: null,
    repoUrls: [],
    pullRequests: [],
    workerHandle: "local-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    idleAt: null,
    expiresAt: null,
    errorMessage: null,
  };
}

test("dispatchTurn posts a start-turn payload to neo-loop", async () => {
  const seen: unknown[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      seen.push({ url: req.url, body: JSON.parse(raw) });
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ turnId: "t1", runId: "run-loop-1", accepted: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const previous = process.env.NEO_LOOP_URL;
  process.env.NEO_LOOP_URL = `http://127.0.0.1:${port}`;
  try {
    const result = await dispatchTurn(fakeRun(), "jwt-1", { delivery: "prompt", text: "hello" });
    assert.equal(result?.accepted, true);
    const posted = seen[0] as { url: string; body: { text: string; jwt: string; runId: string } };
    assert.equal(posted.url, "/internal/loop/turns");
    assert.equal(posted.body.text, "hello");
    assert.equal(posted.body.jwt, "jwt-1");
    assert.equal(posted.body.runId, "run-loop-1");
  } finally {
    if (previous === undefined) {
      delete process.env.NEO_LOOP_URL;
    } else {
      process.env.NEO_LOOP_URL = previous;
    }
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

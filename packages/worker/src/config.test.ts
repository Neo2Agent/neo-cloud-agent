import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("getWorkerConfig reads tools-role loop coordinates from the bootstrap file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-worker-cfg-"));
  const file = path.join(dir, "run-bootstrap.json");
  writeFileSync(
    file,
    JSON.stringify({
      runId: "run-boot-1",
      jwt: "jwt",
      controlPlaneUrl: "http://cp",
      llmGatewayUrl: "http://llm",
      model: "neo/deepseek",
      workerRole: "tools",
      neoLoopUrl: "http://127.0.0.1:8082",
      neoLoopToken: "loop-token",
    }),
  );
  const previous = {
    bootstrap: process.env.NEO_RUN_BOOTSTRAP,
    role: process.env.WORKER_ROLE,
    url: process.env.NEO_LOOP_URL,
    token: process.env.NEO_LOOP_TOKEN,
  };
  process.env.NEO_RUN_BOOTSTRAP = file;
  delete process.env.WORKER_ROLE;
  delete process.env.NEO_LOOP_URL;
  delete process.env.NEO_LOOP_TOKEN;
  try {
    const { getWorkerConfig } = await import("./config.js");
    const config = getWorkerConfig();
    assert.equal(config.workerRole, "tools");
    assert.equal(config.neoLoopUrl, "http://127.0.0.1:8082");
    assert.equal(config.neoLoopToken, "loop-token");
  } finally {
    if (previous.bootstrap === undefined) {
      delete process.env.NEO_RUN_BOOTSTRAP;
    } else {
      process.env.NEO_RUN_BOOTSTRAP = previous.bootstrap;
    }
    if (previous.role === undefined) {
      delete process.env.WORKER_ROLE;
    } else {
      process.env.WORKER_ROLE = previous.role;
    }
    if (previous.url === undefined) {
      delete process.env.NEO_LOOP_URL;
    } else {
      process.env.NEO_LOOP_URL = previous.url;
    }
    if (previous.token === undefined) {
      delete process.env.NEO_LOOP_TOKEN;
    } else {
      process.env.NEO_LOOP_TOKEN = previous.token;
    }
  }
});

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, test, type TestContext } from "node:test";
import type { Run, RunEvent, RunEventKind } from "@neo-cloud-agent/contracts";
import type { CliIo } from "./io.js";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "cli-e2e-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-cli-e2e-"));
process.env.OBJECT_STORE = "memory";
process.env.BUILD_CAPTURE = "0";
process.env.WARM_POOL_SIZE = "0";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.CONTROL_PLANE_AUTH;
process.env.ACCOUNTS_REQUIRED = "0";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("../../control-plane/src/api/server.js");
const { listen, close } = await import("../../control-plane/src/e2e/helpers.js");
const { ingestEvents } = await import("../../control-plane/src/orchestrator/orchestrator.js");
const { setObjectStoreForTests } = await import("../../control-plane/src/objects/store.js");
const { createMemoryObjectStore } = await import("../../control-plane/src/objects/memory.js");
const { main } = await import("./index.js");

setObjectStoreForTests(createMemoryObjectStore());

function captureIo(env: NodeJS.ProcessEnv = {}): { io: CliIo; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const dir = mkdtempSync(path.join(tmpdir(), "neo-cli-home-"));
  return {
    io: {
      out: { write: (chunk) => { out += chunk; } },
      err: { write: (chunk) => { err += chunk; } },
      stdin: Readable.from([]),
      env: { NEO_CONFIG_DIR: dir, ...env },
      cwd: process.cwd(),
      now: () => Date.now(),
      isStdoutTty: false,
      isStdinTty: true,
      homedir: () => dir,
    },
    out: () => out,
    err: () => err,
  };
}

function ev(runId: string, kind: RunEventKind, title: string, data?: Record<string, unknown>): RunEvent {
  return {
    id: crypto.randomUUID(),
    runId,
    createdAt: new Date().toISOString(),
    category: "agent_run",
    level: "info",
    kind,
    title,
    data,
  };
}

async function startServer(t: TestContext): Promise<string> {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  return `http://127.0.0.1:${port}`;
}

describe("cli e2e", { concurrency: false }, () => {
test("cli creates a cloud run, lists it, and resumes after IDLE", async (t) => {
  const base = await startServer(t);
  const created = captureIo();
  const code = await main(
    ["--url", base, "run", "--repo", "fixtures/toy-repo", "--detach", "--output-format", "json", "只回复 pong"],
    created.io,
  );
  assert.equal(code, 0, created.err());
  const body = JSON.parse(created.out()) as { run_id: string; subtype: string };
  assert.equal(body.subtype, "detached");
  assert.ok(body.run_id);

  const listed = captureIo();
  assert.equal(await main(["--url", base, "ls", "--json"], listed.io), 0);
  const runs = (JSON.parse(listed.out()) as { runs: Run[] }).runs;
  const run = runs.find((item) => item.id === body.run_id);
  assert.ok(run);
  assert.equal(run.source, "cli");
  assert.deepEqual(run.repoUrls, ["fixtures/toy-repo"]);

  ingestEvents(run.id, [
    ev(run.id, "agent.start", "Agent turn started"),
    ev(run.id, "message.delta", "Assistant text", { delta: "pong" }),
    ev(run.id, "agent.end", "Agent turn finished"),
  ]);

  const resumed = captureIo();
  assert.equal(await main(["--url", base, "resume", run.id, "--output-format", "json"], resumed.io), 0, resumed.err());
  const result = JSON.parse(resumed.out()) as { status: string; result: string; protocol: string };
  assert.equal(result.status, "IDLE");
  assert.equal(result.result, "pong");
  assert.equal(result.protocol, "neo.cli.v1");
});

test("cli wait follows SSE until agent.end", async (t) => {
  const base = await startServer(t);
  const created = captureIo();
  assert.equal(
    await main(["--url", base, "run", "--repo", "fixtures/toy-repo", "--detach", "stream me"], created.io),
    0,
    created.err(),
  );
  const runId = created.out().trim();
  assert.match(runId, /^[0-9a-f-]{36}$/);

  const waiting = captureIo();
  const pending = main(
    ["--url", base, "resume", runId, "--output-format", "stream-json", "--timeout", "5s"],
    waiting.io,
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  ingestEvents(runId, [
    ev(runId, "agent.start", "Agent turn started"),
    ev(runId, "message.delta", "Assistant text", { delta: "ok" }),
    ev(runId, "agent.end", "Agent turn finished"),
  ]);
  assert.equal(await pending, 0, waiting.err());
  const lines = waiting
    .out()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; text?: string; subtype?: string });
  assert.equal(lines[0]?.type, "system");
  assert.ok(lines.some((line) => line.type === "assistant" && line.text === "ok"));
  assert.equal(lines.at(-1)?.type, "result");
  assert.equal(lines.at(-1)?.subtype, "success");
});

test("cli login --token talks to a token-gated control plane", async (t) => {
  process.env.CONTROL_PLANE_TOKEN = "cli-e2e-token";
  const base = await startServer(t);
  t.after(() => {
    delete process.env.CONTROL_PLANE_TOKEN;
  });

  const denied = captureIo();
  assert.equal(await main(["--url", base, "ls"], denied.io), 2);
  assert.match(denied.err(), /unauthorized/);

  const login = captureIo();
  assert.equal(await main(["--url", base, "login", "--token", "cli-e2e-token"], login.io), 0, login.err());
  assert.match(login.out(), /saved token/);

  const listed = captureIo({
    NEO_CONFIG_DIR: login.io.env.NEO_CONFIG_DIR,
  });
  assert.equal(await main(["--url", base, "ls", "--json"], listed.io), 0, listed.err());
  assert.ok(JSON.parse(listed.out()).runs);
});
});

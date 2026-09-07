import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  archiveRun,
  attachSse,
  close,
  fetchRunTranscript,
  listen,
  waitForRun,
  waitUntil,
} from "./helpers.js";

test("default pi kernel: live SSE deltas and a follow-up turn", { timeout: 120_000 }, async (t) => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-pi-stream-"));
  process.env.WORKER_RUNTIME = "local";
  process.env.SPAWN_LOCAL_WORKER = "1";
  delete process.env.AGENT_KERNEL;
  process.env.LLM_SETTINGS_DIR = mkdtempSync(path.join(tmpdir(), "neo-pi-stream-llm-"));
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.LLM_UPSTREAM_API_KEY;
  process.env.LLM_UPSTREAM = "mock";
  process.env.LLM_GATEWAY_JWT_SECRET = "e2e-pi-stream-secret";
  process.env.RUNS_DIR = runsDir;
  process.env.HOST_RUNS_DIR = runsDir;
  process.env.ACCOUNTS_REQUIRED = "0";
  process.env.WORKER_IDLE_RELEASE_MS = "0";
  delete process.env.WORKER_CONTROL_PLANE_URL;
  delete process.env.WORKER_LLM_GATEWAY_URL;

  const { createGatewayServer } = await import("../../../llm-gateway/src/server.js");
  const { createApiServer } = await import("../api/server.js");

  const gateway = createGatewayServer();
  const gatewayPort = await listen(gateway);
  process.env.LLM_GATEWAY_URL = `http://127.0.0.1:${gatewayPort}`;
  process.env.LLM_GATEWAY_PORT = String(gatewayPort);

  const api = createApiServer();
  const apiPort = await listen(api);
  process.env.CONTROL_PLANE_URL = `http://127.0.0.1:${apiPort}`;
  process.env.CONTROL_PLANE_PORT = String(apiPort);
  const apiBase = `http://127.0.0.1:${apiPort}`;
  let runId = "";
  let live: ReturnType<typeof attachSse> | undefined;

  const health = (await (await fetch(`${apiBase}/health`)).json()) as { agentKernel?: string };
  assert.equal(health.agentKernel, "pi");

  const created = await fetch(`${apiBase}/v1/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "第一轮：只回复一个词 pong。不要调用工具。",
      repoUrls: ["fixtures/toy-repo"],
      source: "api",
    }),
  });
  assert.equal(created.status, 201);
  const run = (await created.json()) as {
    id: string;
    status: string;
    errorMessage: string | null;
    kernel?: string;
  };
  runId = run.id;
  assert.equal(run.kernel, "pi");
  assert.equal(run.status, "RUNNING", run.errorMessage ?? "");

  live = attachSse(apiBase, run.id);
  t.after(async () => {
    live?.close();
    if (runId) {
      await fetch(`${apiBase}/v1/runs/${runId}/abort`, { method: "POST" }).catch(() => undefined);
      await archiveRun(apiBase, runId);
    }
    await close(api);
    await close(gateway);
    process.env.WORKER_RUNTIME = "none";
  });

  await waitUntil(
    () => live.events.some((item) => item.kind === "message.delta"),
    45_000,
    `no live message.delta; saw ${live.events.map((item) => item.kind).join(",")}`,
  );

  const first = await waitForRun(apiBase, run.id, 45_000);
  assert.notEqual(first.status, "ERROR", first.errorMessage ?? first.kinds.join(","));
  assert.equal(first.status, "IDLE");
  assert.ok(first.kinds.includes("agent.start"), first.kinds.join(","));
  assert.ok(first.kinds.includes("agent.end"), first.kinds.join(","));
  assert.ok(first.kinds.includes("message.delta"), first.kinds.join(","));

  const afterFirst = await fetchRunTranscript(apiBase, run.id);
  const firstUsers = afterFirst.messages.filter((item) => item.role === "user");
  const firstAssistants = afterFirst.messages.filter((item) => item.role === "assistant" && item.text.trim());
  assert.ok(firstUsers.some((item) => item.text.includes("pong")));
  assert.ok(firstAssistants.length >= 1, "first turn should produce assistant text");
  assert.equal(
    firstAssistants.every((item) => item.streaming !== true),
    true,
    "assistant should stop streaming after the first turn",
  );

  const deltasBeforeFollow = live.events.filter((item) => item.kind === "message.delta").length;
  const follow = await fetch(`${apiBase}/v1/runs/${run.id}/follow-ups`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "第二轮：只回复一个词 ok。不要调用工具。" }),
  });
  assert.equal(follow.status, 201, await follow.text());

  await waitUntil(
    () => live.events.filter((item) => item.kind === "message.delta").length > deltasBeforeFollow,
    45_000,
    "follow-up did not stream new message.delta events",
  );

  const second = await waitForRun(apiBase, run.id, 45_000, { minAgentEnds: 2 });
  assert.notEqual(second.status, "ERROR", second.errorMessage ?? second.kinds.join(","));
  assert.equal(second.status, "IDLE");
  assert.ok(second.kinds.filter((kind) => kind === "agent.end").length >= 2, second.kinds.join(","));
  assert.ok(second.kinds.includes("followup.queued"), second.kinds.join(","));

  const afterSecond = await fetchRunTranscript(apiBase, run.id);
  const users = afterSecond.messages.filter((item) => item.role === "user");
  const assistants = afterSecond.messages.filter((item) => item.role === "assistant" && item.text.trim());
  assert.ok(users.some((item) => item.text.includes("pong")));
  assert.ok(users.some((item) => item.text.includes("第二轮") || item.text.includes("ok")));
  assert.ok(assistants.length >= 2, `expected two assistant replies, got ${assistants.length}`);
  assert.equal(
    assistants.every((item) => item.streaming !== true),
    true,
    "assistant should stop streaming after the follow-up",
  );
  assert.ok(
    live.events.filter((item) => item.kind === "message.delta").length >= 2,
    "SSE should carry multiple live deltas across both turns",
  );
});

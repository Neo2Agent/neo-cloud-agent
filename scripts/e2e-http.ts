#!/usr/bin/env tsx
/**
 * HTTP e2e against a running control-plane.
 *
 *   pnpm test:e2e
 *   E2E_EXPECT_README=1 pnpm test:e2e:live
 */
const base = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const prompt =
  process.env.E2E_PROMPT ??
  (process.env.E2E_EXPECT_README === "1"
    ? "工作区已经有玩具仓库。请新增 README.md（简短说明这是 toy-repo），然后运行 sh test.sh。不要改 test.sh。完成后用一句话汇报测试结果。"
    : "只回复一个词：pong。不要调用工具。");
const repo = process.env.E2E_REPO ?? "fixtures/toy-repo";
const expectReadme = process.env.E2E_EXPECT_README === "1";
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? 120_000);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const healthRes = await fetch(`${base}/health`);
if (!healthRes.ok) {
  fail(`control-plane health ${healthRes.status}`);
}
const health = (await healthRes.json()) as { ok?: boolean; workerRuntime?: string; defaultModel?: string };
if (!health.ok) {
  fail("control-plane not healthy");
}
console.log(`health workerRuntime=${health.workerRuntime ?? "?"} model=${health.defaultModel ?? "?"}`);

const createdRes = await fetch(`${base}/v1/runs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt, repoUrls: [repo], source: "api" }),
});
const run = (await createdRes.json()) as { id?: string; status?: string; errorMessage?: string | null };
if (!run.id) {
  fail(`create run failed: ${JSON.stringify(run)}`);
}
console.log(`created ${run.id} status=${run.status}`);

const deadline = Date.now() + timeoutMs;
let kinds: string[] = [];
let status = run.status ?? "";
while (Date.now() < deadline) {
  const transcript = (await (await fetch(`${base}/v1/runs/${run.id}/transcript`)).json()) as {
    events?: Array<{ kind: string; title?: string }>;
  };
  kinds = (transcript.events ?? []).map((item) => item.kind);
  const latest = (await (await fetch(`${base}/v1/runs/${run.id}`)).json()) as {
    status: string;
    errorMessage: string | null;
  };
  status = latest.status;
  if (kinds.includes("agent.end") || status === "ERROR" || status === "IDLE") {
    if (status === "ERROR") {
      fail(`run error: ${latest.errorMessage ?? kinds.join(",")}`);
    }
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
}

if (!kinds.includes("scm.clone_succeeded")) {
  fail(`missing scm.clone_succeeded; events=${kinds.join(",")}`);
}
if (!kinds.includes("agent.end") || status !== "IDLE") {
  fail(`did not reach IDLE; status=${status} events=${kinds.join(",")}`);
}

if (expectReadme) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const readme = path.join(process.env.RUNS_DIR ?? ".neo/runs", run.id, "README.md");
  if (!fs.existsSync(readme)) {
    fail(`expected ${readme}`);
  }
  console.log(`readme ok ${readme}`);
}

console.log(`ok ${run.id} ${status} events=${kinds.length}`);

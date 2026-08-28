import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { PluginCatalogItem, Project, Run } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "plugins-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-plugins-"));
process.env.ACCOUNTS_REQUIRED = "1";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.CONTROL_PLANE_AUTH;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.BOOTSTRAP_EMAIL;
delete process.env.BOOTSTRAP_PASSWORD;

const { createApiServer } = await import("./server.js");
const { createTeammateAccount, ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { listen, close } = await import("../e2e/helpers.js");

const runsDir = process.env.RUNS_DIR;

async function login(base: string, email: string, password: string): Promise<{ token: string; user: { id: string; email: string } }> {
  const response = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { token?: string; user?: { id: string; email: string }; error?: string };
  assert.equal(response.status, 200, body.error ?? "login failed");
  assert.ok(body.token && body.user);
  return { token: body.token, user: body.user };
}

function auth(token: string): { "content-type": string; authorization: string } {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

test("plugins list bundled, install, materialize, disable, and pin on projects", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();
  const admin = await login(base, "admin", "123456");

  const listed = await fetch(`${base}/v1/plugins`, { headers: auth(admin.token) });
  assert.equal(listed.status, 200);
  const listBody = (await listed.json()) as { plugins: PluginCatalogItem[] };
  assert.ok(listBody.plugins.some((item) => item.slug === "pr-review"));
  assert.ok(listBody.plugins.every((item) => item.visibility === "bundled" && item.installed === false));

  const detail = await fetch(`${base}/v1/plugins/pr-review`, { headers: auth(admin.token) });
  assert.equal(detail.status, 200);
  assert.match(((await detail.json()) as PluginCatalogItem).preview ?? "", /PR review/);

  const plain = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ prompt: "默认不装", repoUrls: ["fixtures/toy-repo"] }),
  });
  assert.equal(plain.status, 201);
  const plainRun = (await plain.json()) as Run;
  assert.equal(existsSync(path.join(runsDir, plainRun.id, ".neo", "skills", "pr-review", "SKILL.md")), false);

  const installed = await fetch(`${base}/v1/plugins/pr-review/install`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ scope: "user" }),
  });
  assert.equal(installed.status, 200);
  assert.equal(((await installed.json()) as PluginCatalogItem).enabled, true);

  const runRes = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ prompt: "审查这次改动", repoUrls: ["fixtures/toy-repo"] }),
  });
  assert.equal(runRes.status, 201);
  const run = (await runRes.json()) as Run;
  assert.ok(run.plugins?.some((item) => item.slug === "pr-review"));
  const skillFile = path.join(runsDir, run.id, ".neo", "skills", "pr-review", "SKILL.md");
  assert.equal(existsSync(skillFile), true);
  assert.match(readFileSync(skillFile, "utf8"), /Blockers/);
  const snapshot = JSON.parse(readFileSync(path.join(runsDir, run.id, ".neo", "plugins.json"), "utf8")) as {
    plugins: Array<{ slug: string }>;
    warnings: string[];
  };
  assert.ok(snapshot.plugins.some((item) => item.slug === "pr-review"));
  assert.equal(
    snapshot.warnings.some((item) => item.includes("未覆盖")),
    false,
    snapshot.warnings.join("; "),
  );

  await createTeammateAccount({ email: "mate", password: "654321", orgId: admin.user.id });
  const mate = await login(base, "mate", "654321");
  const mateRun = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(mate.token),
    body: JSON.stringify({ prompt: "看不到别人的安装", repoUrls: ["fixtures/toy-repo"] }),
  });
  assert.equal(mateRun.status, 201);
  const other = (await mateRun.json()) as Run;
  assert.equal(existsSync(path.join(runsDir, other.id, ".neo", "skills", "pr-review", "SKILL.md")), false);

  const disabled = await fetch(`${base}/v1/plugins/pr-review/enable`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ enabled: false, scope: "user" }),
  });
  assert.equal(disabled.status, 200);
  const offRun = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ prompt: "关掉后不再拷", repoUrls: ["fixtures/toy-repo"] }),
  });
  assert.equal(offRun.status, 201);
  assert.equal(existsSync(path.join(runsDir, ((await offRun.json()) as Run).id, ".neo", "skills", "pr-review", "SKILL.md")), false);

  const projectRes = await fetch(`${base}/v1/projects`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ name: "技能项目", instruction: "用中文" }),
  });
  assert.equal(projectRes.status, 201);
  const project = (await projectRes.json()) as Project;
  const pinned = await fetch(`${base}/v1/projects/${project.id}`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ pluginIds: ["plug_release_notes"] }),
  });
  assert.equal(pinned.status, 200);
  assert.deepEqual(((await pinned.json()) as Project).pluginIds, ["plug_release_notes"]);
  const sorted = await fetch(`${base}/v1/plugins?projectId=${project.id}`, { headers: auth(admin.token) });
  assert.equal(sorted.status, 200);
  const sortedBody = (await sorted.json()) as { plugins: PluginCatalogItem[] };
  assert.equal(sortedBody.plugins[0]?.id, "plug_release_notes");
  assert.equal(sortedBody.plugins[0]?.pinned, true);

  const projectRun = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ prompt: "项目钉住的技能", repoUrls: ["fixtures/toy-repo"], projectId: project.id }),
  });
  assert.equal(projectRun.status, 201);
  const pinnedRun = (await projectRun.json()) as Run;
  assert.equal(existsSync(path.join(runsDir, pinnedRun.id, ".neo", "skills", "release-notes", "SKILL.md")), true);

  const extra = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({
      prompt: "这次额外启用",
      repoUrls: ["fixtures/toy-repo"],
      pluginIds: ["repo-scout"],
    }),
  });
  assert.equal(extra.status, 201);
  assert.equal(existsSync(path.join(runsDir, ((await extra.json()) as Run).id, ".neo", "skills", "repo-scout", "SKILL.md")), true);
});

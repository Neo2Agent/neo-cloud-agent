import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Expert, ExpertTeam, Project, Run } from "@neo-cloud-agent/contracts";
import { READ_BASH_EXPERT_TOOLS } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "experts-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-experts-"));
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

test("experts list bundled, persist mine, inject role files, and pin on projects", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();
  const admin = await login(base, "admin", "123456");

  const listed = await fetch(`${base}/v1/experts`, { headers: auth(admin.token) });
  assert.equal(listed.status, 200);
  const listBody = (await listed.json()) as { experts: Expert[] };
  assert.ok(listBody.experts.some((item) => item.id === "exp_reviewer"));
  assert.ok(listBody.experts.every((item) => item.visibility === "bundled"));

  const teamsRes = await fetch(`${base}/v1/expert-teams`, { headers: auth(admin.token) });
  assert.equal(teamsRes.status, 200);
  const teams = ((await teamsRes.json()) as { teams: ExpertTeam[] }).teams;
  assert.ok(teams.some((item) => item.slug === "ship-change"));

  const created = await fetch(`${base}/v1/experts`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({
      name: "发布检查",
      description: "发版前核对清单",
      persona: "You are a release checker.",
      methodology: "Read the diff, then list blockers.",
      deliverables: "## Blockers\n## Notes",
    }),
  });
  assert.equal(created.status, 201);
  const mine = (await created.json()) as Expert;
  assert.equal(mine.visibility, "user");
  assert.equal(mine.ownerUserId, admin.user.id);

  await createTeammateAccount({ email: "mate", password: "654321", orgId: admin.user.id });
  const mate = await login(base, "mate", "654321");
  const hidden = await fetch(`${base}/v1/experts/${mine.id}`, { headers: auth(mate.token) });
  assert.equal(hidden.status, 404);

  const both = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({
      prompt: "不能同时选",
      repoUrls: ["fixtures/toy-repo"],
      expertId: "exp_reviewer",
      expertTeamId: "team_ship_change",
    }),
  });
  assert.equal(both.status, 400);

  const runRes = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({
      prompt: "审查这次改动",
      repoUrls: ["fixtures/toy-repo"],
      expertId: "reviewer",
    }),
  });
  assert.equal(runRes.status, 201);
  const run = (await runRes.json()) as Run;
  assert.equal(run.expertId, "exp_reviewer");
  const expertMd = path.join(runsDir, run.id, ".neo", "EXPERT.md");
  const expertJson = path.join(runsDir, run.id, ".neo", "expert.json");
  assert.equal(existsSync(expertMd), true);
  assert.match(readFileSync(expertMd, "utf8"), /Role Override/);
  assert.match(readFileSync(expertMd, "utf8"), /审查/);
  const meta = JSON.parse(readFileSync(expertJson, "utf8")) as { tools?: string[] };
  assert.deepEqual(meta.tools, [...READ_BASH_EXPERT_TOOLS]);

  const teamRunRes = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({
      prompt: "交付一条改动",
      repoUrls: ["fixtures/toy-repo"],
      expertTeamId: "ship-change",
    }),
  });
  assert.equal(teamRunRes.status, 201);
  const teamRun = (await teamRunRes.json()) as Run;
  assert.equal(teamRun.expertTeamId, "team_ship_change");
  assert.match(readFileSync(path.join(runsDir, teamRun.id, ".neo", "EXPERT_TEAM.md"), "utf8"), /Role Override/);
  assert.equal(existsSync(path.join(runsDir, teamRun.id, ".neo", "agents", "planner.md")), true);

  const projectRes = await fetch(`${base}/v1/projects`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ name: "专家项目", instruction: "用中文" }),
  });
  assert.equal(projectRes.status, 201);
  const project = (await projectRes.json()) as Project;
  const pinned = await fetch(`${base}/v1/projects/${project.id}`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ expertIds: ["exp_security"] }),
  });
  assert.equal(pinned.status, 200);
  assert.deepEqual(((await pinned.json()) as Project).expertIds, ["exp_security"]);
  const sorted = await fetch(`${base}/v1/experts?projectId=${project.id}`, { headers: auth(admin.token) });
  assert.equal(sorted.status, 200);
  const sortedBody = (await sorted.json()) as { experts: Expert[] };
  assert.equal(sortedBody.experts[0]?.id, "exp_security");
});

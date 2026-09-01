import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Project, ProjectAsset, Run } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "assets-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-assets-"));
process.env.OBJECT_STORE = "memory";
process.env.ACCOUNTS_REQUIRED = "1";
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const runsDir = process.env.RUNS_DIR;
const { createApiServer } = await import("./server.js");
const { ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { listen, close } = await import("../e2e/helpers.js");

async function login(base: string, email: string, password: string) {
  const response = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await response.json()) as { token: string; user: { id: string } };
}

function auth(token: string) {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

test("project assets persist after a new run and can copy artifacts", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => close(server));
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();
  const admin = await login(base, "admin", "123456");
  const project = (await (
    await fetch(`${base}/v1/projects`, {
      method: "POST",
      headers: auth(admin.token),
      body: JSON.stringify({ name: "资料库", instruction: "记得看资产清单" }),
    })
  ).json()) as Project;

  const uploaded = await fetch(`${base}/v1/projects/${project.id}/assets`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ path: "MEMORY.md", content: "# 团队记忆\n" }),
  });
  assert.equal(uploaded.status, 201);
  const asset = (await uploaded.json()) as ProjectAsset;
  assert.equal(asset.path, "MEMORY.md");

  const htmlUp = await fetch(`${base}/v1/projects/${project.id}/assets`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ path: "board.html", content: "<h1>预览</h1>", contentType: "text/html" }),
  });
  assert.equal(htmlUp.status, 201);
  const htmlAsset = (await htmlUp.json()) as ProjectAsset;
  const htmlGet = await fetch(`${base}/v1/projects/${project.id}/assets/${htmlAsset.id}`, { headers: auth(admin.token) });
  assert.equal(htmlGet.status, 200);
  assert.match(htmlGet.headers.get("content-type") ?? "", /charset=utf-8/i);
  assert.equal(await htmlGet.text(), "<h1>预览</h1>");

  await fetch(`${base}/v1/projects/${project.id}/members`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ email: "reader", password: "654321" }),
  });
  const reader = await login(base, "reader", "654321");
  const listed = await fetch(`${base}/v1/projects/${project.id}/assets`, { headers: auth(reader.token) });
  assert.equal(listed.status, 200);
  assert.equal(((await listed.json()) as { assets: ProjectAsset[] }).assets.some((item) => item.path === "MEMORY.md"), true);

  const runRes = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(reader.token),
    body: JSON.stringify({
      prompt: "看清单",
      repoUrls: ["fixtures/toy-repo"],
      projectId: project.id,
      assetIds: [asset.id],
    }),
  });
  const run = (await runRes.json()) as Run;
  assert.deepEqual(run.attachedAssetIds, [asset.id]);
  const memory = path.join(runsDir, run.id, ".neo", "PROJECT.md");
  assert.equal(existsSync(memory), true);
  assert.match(readFileSync(memory, "utf8"), /MEMORY.md/);
  assert.match(readFileSync(memory, "utf8"), /这次带上的文件/);
  const copied = path.join(runsDir, run.id, ".neo", "attached", "MEMORY.md");
  assert.equal(existsSync(copied), true);
  assert.match(readFileSync(copied, "utf8"), /团队记忆/);

  const artifact = await fetch(`${base}/v1/runs/${run.id}/artifacts`, {
    method: "POST",
    headers: auth(reader.token),
    body: JSON.stringify({ name: "notes.txt", content: "from the run" }),
  });
  assert.equal(artifact.status, 201);
  const listedArtifacts = await fetch(`${base}/v1/runs/${run.id}/artifacts`, { headers: auth(reader.token) });
  assert.equal(listedArtifacts.status, 200);
  const listedBody = (await listedArtifacts.json()) as { artifacts: Array<{ name: string; url: string }> };
  const notesUrl = listedBody.artifacts.find((item) => item.name === "notes.txt")?.url ?? "";
  assert.match(notesUrl, /token=/);
  const preview = await fetch(`${base}${notesUrl}`);
  assert.equal(preview.status, 200);
  assert.equal(await preview.text(), "from the run");

  const saved = await fetch(`${base}/v1/runs/${run.id}/artifacts/notes.txt/save-to-project`, {
    method: "POST",
    headers: auth(reader.token),
    body: JSON.stringify({}),
  });
  assert.equal(saved.status, 201);
  const first = (await saved.json()) as ProjectAsset;
  assert.equal(first.path, "notes.txt");
  assert.equal(first.createdBy, reader.user.id);
  assert.equal(first.updatedBy, reader.user.id);

  const overwritten = await fetch(`${base}/v1/runs/${run.id}/artifacts`, {
    method: "POST",
    headers: auth(reader.token),
    body: JSON.stringify({ name: "notes.txt", content: "from the run v2" }),
  });
  assert.equal(overwritten.status, 201);
  const savedAgain = await fetch(`${base}/v1/runs/${run.id}/artifacts/notes.txt/save-to-project`, {
    method: "POST",
    headers: auth(reader.token),
    body: JSON.stringify({}),
  });
  assert.equal(savedAgain.status, 201);
  const second = (await savedAgain.json()) as ProjectAsset;
  assert.equal(second.id, first.id);
  assert.equal(second.createdBy, first.createdBy);
  assert.equal(second.updatedBy, reader.user.id);
  const afterOverwrite = await fetch(`${base}/v1/projects/${project.id}/assets`, { headers: auth(reader.token) });
  const afterBody = (await afterOverwrite.json()) as { assets: ProjectAsset[] };
  assert.equal(afterBody.assets.filter((item) => item.path === "notes.txt").length, 1);
  const reread = await fetch(`${base}/v1/projects/${project.id}/assets/${second.id}`, { headers: auth(reader.token) });
  assert.equal(reread.status, 200);
  assert.equal(await reread.text(), "from the run v2");

  const handoff = await fetch(`${base}/v1/projects/${project.id}/todos`, {
    method: "POST",
    headers: auth(reader.token),
    body: JSON.stringify({ title: "带附件", runId: run.id, source: "handoff", artifactNames: ["notes.txt", "missing.bin"] }),
  });
  assert.equal(handoff.status, 201);
  const todo = (await handoff.json()) as { attachments: Array<{ name: string }>; failedAttachments: string[] };
  assert.equal(todo.attachments.some((item) => item.name === "notes.txt"), true);
  assert.deepEqual(todo.failedAttachments, ["missing.bin"]);

  const denied = await fetch(`${base}/v1/projects/${project.id}/assets/${asset.id}`, {
    method: "DELETE",
    headers: auth(reader.token),
  });
  assert.equal(denied.status, 400);
  const removed = await fetch(`${base}/v1/projects/${project.id}/assets/${asset.id}`, {
    method: "DELETE",
    headers: auth(admin.token),
  });
  assert.equal(removed.status, 200);
});

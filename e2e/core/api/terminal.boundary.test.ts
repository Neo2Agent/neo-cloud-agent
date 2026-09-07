import assert from "node:assert/strict";
import test from "node:test";
import {
  createMate,
  createRunOk,
  jsonHeaders,
  login,
  readJson,
  startCoreApi,
} from "./helpers.js";

test("term: unauthenticated open is 401", async (t) => {
  const { resetWorkspaceShellsForTests } = await import("../../../packages/control-plane/src/runtime/workspace-shell.js");
  resetWorkspaceShellsForTests();
  const api = await startCoreApi();
  t.after(async () => {
    resetWorkspaceShellsForTests();
    await api.close();
  });
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const denied = await fetch(`${api.base}/v1/runs/${run.id}/term`, { method: "POST" });
  assert.equal(denied.status, 401);
});

test("term: happy open, write, list, and close", async (t) => {
  const { resetWorkspaceShellsForTests } = await import("../../../packages/control-plane/src/runtime/workspace-shell.js");
  resetWorkspaceShellsForTests();
  const api = await startCoreApi();
  t.after(async () => {
    resetWorkspaceShellsForTests();
    await api.close();
  });
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const opened = await fetch(`${api.base}/v1/runs/${run.id}/term`, {
    method: "POST",
    headers: jsonHeaders(token),
  });
  assert.equal(opened.status, 201);
  const session = await readJson<{ id: string; alive?: boolean; shell?: string }>(opened);
  assert.ok(session.id);
  assert.equal(session.alive, true);
  assert.match(session.shell ?? "", /zsh|bash|sh/);

  const listed = await fetch(`${api.base}/v1/runs/${run.id}/term`, { headers: jsonHeaders(token) });
  assert.equal(listed.status, 200);
  const listing = await readJson<{ sessions: Array<{ id: string }> }>(listed);
  assert.equal(listing.sessions.some((item) => item.id === session.id), true);

  const written = await fetch(`${api.base}/v1/runs/${run.id}/term/${session.id}`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ data: "true\n" }),
  });
  assert.equal(written.status, 200);

  const closed = await fetch(`${api.base}/v1/runs/${run.id}/term/${session.id}`, {
    method: "DELETE",
    headers: jsonHeaders(token),
  });
  assert.equal(closed.status, 200);
});

test("term: write longer than 16384 bytes is 400", async (t) => {
  const { resetWorkspaceShellsForTests } = await import("../../../packages/control-plane/src/runtime/workspace-shell.js");
  resetWorkspaceShellsForTests();
  const api = await startCoreApi();
  t.after(async () => {
    resetWorkspaceShellsForTests();
    await api.close();
  });
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const opened = await fetch(`${api.base}/v1/runs/${run.id}/term`, { method: "POST", headers: jsonHeaders(token) });
  const session = await readJson<{ id: string }>(opened);
  const response = await fetch(`${api.base}/v1/runs/${run.id}/term/${session.id}`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ data: "x".repeat(16_385) }),
  });
  assert.equal(response.status, 400);
  assert.equal((await readJson<{ error?: string }>(response)).error, "input too long");
});

test("term: session id from another run is 404", async (t) => {
  const { resetWorkspaceShellsForTests } = await import("../../../packages/control-plane/src/runtime/workspace-shell.js");
  resetWorkspaceShellsForTests();
  const api = await startCoreApi();
  t.after(async () => {
    resetWorkspaceShellsForTests();
    await api.close();
  });
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const other = await createRunOk(api.base, token, { prompt: "other term" });
  const opened = await fetch(`${api.base}/v1/runs/${run.id}/term`, { method: "POST", headers: jsonHeaders(token) });
  const session = await readJson<{ id: string }>(opened);
  const stolen = await fetch(`${api.base}/v1/runs/${other.id}/term/${session.id}`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ data: "echo no\n" }),
  });
  assert.equal(stolen.status, 404);
});

test("term: other user cannot open a shell on this run", async (t) => {
  const { resetWorkspaceShellsForTests } = await import("../../../packages/control-plane/src/runtime/workspace-shell.js");
  resetWorkspaceShellsForTests();
  const api = await startCoreApi();
  t.after(async () => {
    resetWorkspaceShellsForTests();
    await api.close();
  });
  const admin = await login(api.base);
  const mate = await createMate(api.base);
  const run = await createRunOk(api.base, admin.token);
  const stolen = await fetch(`${api.base}/v1/runs/${run.id}/term`, {
    method: "POST",
    headers: jsonHeaders(mate.token),
  });
  assert.equal(stolen.status, 404);
});

test("term: fifth live session is 409", async (t) => {
  const { MAX_TERMS_PER_RUN, resetWorkspaceShellsForTests } = await import(
    "../../../packages/control-plane/src/runtime/workspace-shell.js"
  );
  resetWorkspaceShellsForTests();
  const api = await startCoreApi();
  t.after(async () => {
    resetWorkspaceShellsForTests();
    await api.close();
  });
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  for (let i = 0; i < MAX_TERMS_PER_RUN; i += 1) {
    const opened = await fetch(`${api.base}/v1/runs/${run.id}/term`, { method: "POST", headers: jsonHeaders(token) });
    assert.equal(opened.status, 201, `open #${i + 1}`);
  }
  const extra = await fetch(`${api.base}/v1/runs/${run.id}/term`, { method: "POST", headers: jsonHeaders(token) });
  assert.equal(extra.status, 409);
  assert.match((await readJson<{ error?: string }>(extra)).error ?? "", /最多开 4 个终端/);
});

test("term: desk-targeted run is denied with 409 copy", async () => {
  const { colocatedTarget } = await import("../../../packages/contracts/src/run.js");
  const { workspaceTermDeniedReason } = await import("../../../packages/control-plane/src/runtime/workspace-shell.js");
  const denied = workspaceTermDeniedReason(colocatedTarget("desk", "desk_1"));
  assert.match(denied ?? "", /Desk/);
  assert.match(denied ?? "", /网页打不开/);
});

test("term: close unknown session is 404", async (t) => {
  const { resetWorkspaceShellsForTests } = await import("../../../packages/control-plane/src/runtime/workspace-shell.js");
  resetWorkspaceShellsForTests();
  const api = await startCoreApi();
  t.after(async () => {
    resetWorkspaceShellsForTests();
    await api.close();
  });
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const closed = await fetch(`${api.base}/v1/runs/${run.id}/term/term_missing`, {
    method: "DELETE",
    headers: jsonHeaders(token),
  });
  assert.equal(closed.status, 404);
});

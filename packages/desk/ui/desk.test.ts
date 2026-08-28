import assert from "node:assert/strict";
import test from "node:test";
import {
  asWorkspaceRef,
  isLocalDeskKind,
  localRunLabel,
  localRunTarget,
  mergeDeskTarget,
  withApiBase,
  withDeskClient,
} from "./desk";

test("asWorkspaceRef accepts a path string from an older preload", () => {
  const picked = asWorkspaceRef("/tmp/desk-local-verify");
  assert.deepEqual(picked, {
    id: "",
    folder: "/tmp/desk-local-verify",
    name: "desk-local-verify",
    git: false,
  });
});

test("asWorkspaceRef maps workspaceId onto id", () => {
  const picked = asWorkspaceRef({
    workspaceId: "dws_1",
    folder: "/tmp/desk-local-verify",
    name: "desk-local-verify",
    git: true,
  });
  assert.equal(picked?.id, "dws_1");
  assert.equal(picked?.folder, "/tmp/desk-local-verify");
});

test("mergeDeskTarget keeps the live desk id when the picker only changes folder", () => {
  const next = mergeDeskTarget({ kind: "desk", folder: "/tmp/sql", workspaceId: "dws_1" }, "desk_live");
  assert.equal(next.deskId, "desk_live");
  assert.equal(next.folder, "/tmp/sql");
  assert.deepEqual(localRunTarget({ kind: "desk", workspaceId: "dws_local_abc" }, "desk_live"), {
    loop: "desk",
    tools: "desk",
    deskId: "desk_live",
  });
  assert.deepEqual(localRunTarget({ kind: "remote", workspaceId: "dws_local_abc" }, "desk_live"), {
    loop: "desk",
    tools: "desk",
    deskId: "desk_live",
    remoteControl: true,
  });
  assert.equal(isLocalDeskKind("desk"), true);
  assert.equal(isLocalDeskKind("remote"), true);
  assert.equal(isLocalDeskKind("cloud"), false);
  assert.equal(localRunLabel({ executionTarget: { loop: "desk", remoteControl: true } }), "Remote Control");
  assert.equal(localRunLabel({ executionTarget: { loop: "desk" } }), "This Computer");
});

test("withDeskClient marks Desk traffic without a custom header", () => {
  assert.equal(withDeskClient("/v1/me"), "/v1/me?client=desk");
  assert.equal(withDeskClient("/v1/runs?limit=80"), "/v1/runs?limit=80&client=desk");
  assert.equal(withDeskClient("/v1/runs?client=desk"), "/v1/runs?client=desk");
});

test("withApiBase stays on neo-desk:// when the packaged preload proxies API", () => {
  const previous = (globalThis as { window?: Window & { neoDesk?: { apiBase: string; proxyApi?: boolean } } }).window;
  (globalThis as { window: { neoDesk: { apiBase: string; proxyApi: boolean } } }).window = {
    neoDesk: { apiBase: "https://neorun.cloud", proxyApi: true },
  };
  try {
    assert.equal(withApiBase("/v1/auth/login"), "/v1/auth/login");
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
});

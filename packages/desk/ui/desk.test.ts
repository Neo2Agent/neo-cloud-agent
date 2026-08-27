import assert from "node:assert/strict";
import test from "node:test";
import { asWorkspaceRef, localRunTarget, mergeDeskTarget, withApiBase } from "./desk";

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
  assert.deepEqual(localRunTarget({ kind: "desk", workspaceId: "dws_1" }, "desk_live"), {
    loop: "desk",
    tools: "desk",
    deskId: "desk_live",
    deskWorkspaceId: "dws_1",
  });
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

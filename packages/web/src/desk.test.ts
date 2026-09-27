import assert from "node:assert/strict";
import test from "node:test";
import {
  asWorkspaceRef,
  notifyDesk,
  subscribeDeskDeepLink,
  subscribeDeskDispatched,
  subscribeDeskTarget,
  withApiBase,
} from "./desk.ts";

function withWindow(neoDesk: unknown, run: () => void): void {
  const prev = (globalThis as { window?: unknown }).window;
  (globalThis as { window: { neoDesk: unknown } }).window = { neoDesk };
  try {
    run();
  } finally {
    (globalThis as { window?: unknown }).window = prev;
  }
}

test("packaged Desk keeps /v1 on the renderer origin", () => {
  withWindow({ proxyApi: true, apiBase: "https://neorun.cloud" }, () => {
    assert.equal(withApiBase("/v1/runs"), "/v1/runs");
  });
});

test("asWorkspaceRef accepts a path or the host folder object", () => {
  assert.equal(asWorkspaceRef(null), null);
  assert.deepEqual(asWorkspaceRef("/tmp/repo"), {
    id: "",
    folder: "/tmp/repo",
    name: "repo",
    git: false,
  });
  assert.deepEqual(asWorkspaceRef({ id: "ws_1", folder: "/home/me/app", name: "app", git: true }), {
    id: "ws_1",
    folder: "/home/me/app",
    name: "app",
    git: true,
  });
  assert.equal(asWorkspaceRef({ id: "ws_1" }), null);
});

test("missing preload methods do not throw when Web mounts in Electron", () => {
  withWindow({ apiBase: "http://127.0.0.1:8080", canRunLocal: true }, () => {
    const offLink = subscribeDeskDeepLink(() => {
      throw new Error("should not fire");
    });
    const offTarget = subscribeDeskTarget(() => {
      throw new Error("should not fire");
    });
    const offDispatch = subscribeDeskDispatched(() => {
      throw new Error("should not fire");
    });
    notifyDesk("对话已完成", "Neo");
    offLink();
    offTarget();
    offDispatch();
  });
});

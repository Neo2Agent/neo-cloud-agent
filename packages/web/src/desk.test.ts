import assert from "node:assert/strict";
import test from "node:test";
import {
  type DeskTarget,
  asWorkspaceRef,
  gateLocalCreate,
  hostCreateRunFields,
  localCreateHint,
  localRunLabel,
  localRunTarget,
  mergeDeskTarget,
  normalizeDeskTarget,
  notifyDesk,
  pickedLocalKind,
  targetPickerOptions,
  REMOTE_FOLDER_HINT,
  REMOTE_LOOP_HINT,
  MISSING_DESK_ID_HINT,
  subscribeDeskDeepLink,
  subscribeDeskDispatched,
  subscribeDeskTarget,
  withApiBase,
  withDeskClient,
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

test("normalizeDeskTarget keeps Remote Control and This Computer", () => {
  assert.deepEqual(normalizeDeskTarget(undefined), { kind: "cloud" });
  assert.deepEqual(normalizeDeskTarget({ kind: "remote", folder: "/tmp/repo" }), {
    kind: "remote",
    folder: "/tmp/repo",
  });
  assert.deepEqual(normalizeDeskTarget({ kind: "desk", folder: "/tmp/repo" }), {
    kind: "desk",
    folder: "/tmp/repo",
  });
  assert.deepEqual(normalizeDeskTarget({ kind: "ssh" as DeskTarget["kind"], folder: "/tmp/old" }), {
    kind: "cloud",
    folder: "/tmp/old",
  });
});

test("pickedLocalKind keeps Remote Control when choosing a folder", () => {
  assert.equal(pickedLocalKind("remote"), "remote");
  assert.equal(pickedLocalKind("desk"), "desk");
  assert.equal(pickedLocalKind("cloud"), "desk");
});

test("localRunTarget splits This Computer and Remote Control", () => {
  assert.deepEqual(localRunTarget({ kind: "desk", workspaceId: "dws_local" }, "desk_live"), {
    loop: "desk",
    tools: "desk",
    deskId: "desk_live",
  });
  assert.deepEqual(localRunTarget({ kind: "remote", workspaceId: "dws_local" }, "desk_live"), {
    loop: "cloud",
    tools: "desk",
    deskId: "desk_live",
    remoteControl: true,
  });
  assert.equal(mergeDeskTarget({ kind: "desk", folder: "/tmp/sql" }, "desk_live").deskId, "desk_live");
  assert.equal(localRunLabel({ executionTarget: { loop: "desk" } }), "This Computer");
  assert.equal(
    localRunLabel({ executionTarget: { loop: "cloud", tools: "desk", remoteControl: true } }),
    "Remote Control",
  );
});

test("gateLocalCreate only blocks Desk local starts", () => {
  assert.equal(
    gateLocalCreate({ canRunLocal: false, kind: "remote", deskId: "desk_1", folder: "/tmp/a", remoteAvailable: true }),
    null,
  );
  assert.equal(
    gateLocalCreate({ canRunLocal: true, kind: "cloud", deskId: "desk_1", folder: "", remoteAvailable: false }),
    null,
  );
  assert.equal(
    gateLocalCreate({ canRunLocal: true, kind: "remote", deskId: "desk_1", folder: "/tmp/a", remoteAvailable: false }),
    REMOTE_LOOP_HINT,
  );
  assert.equal(
    gateLocalCreate({ canRunLocal: true, kind: "remote", deskId: "desk_1", folder: "", remoteAvailable: true }),
    REMOTE_FOLDER_HINT,
  );
  assert.equal(
    gateLocalCreate({ canRunLocal: true, kind: "desk", folder: "", remoteAvailable: true }),
    MISSING_DESK_ID_HINT,
  );
});

test("hostCreateRunFields: browser always clouds; Desk inlines local kinds", () => {
  assert.deepEqual(
    hostCreateRunFields({
      canRunLocal: false,
      target: { kind: "remote", folder: "/tmp/repo", deskId: "desk_1" },
      deskId: "desk_1",
      folder: "/tmp/repo",
      cloudRepoUrls: ["https://github.com/acme/app.git"],
      skipCloudRepoDefaults: false,
    }),
    {
      source: "web",
      repoUrls: ["https://github.com/acme/app.git"],
      skipRepoDefaults: false,
      target: { loop: "cloud", tools: "cloud" },
    },
  );
  assert.deepEqual(
    hostCreateRunFields({
      canRunLocal: true,
      target: { kind: "desk", deskId: "desk_1" },
      deskId: "desk_1",
      folder: "/tmp/repo",
      cloudRepoUrls: ["https://github.com/acme/app.git"],
      skipCloudRepoDefaults: false,
    }),
    {
      source: "desk",
      start: "inline",
      kernel: undefined,
      repoUrls: ["/tmp/repo"],
      skipRepoDefaults: false,
      target: { loop: "desk", tools: "desk", deskId: "desk_1" },
    },
  );
  assert.deepEqual(
    hostCreateRunFields({
      canRunLocal: true,
      target: { kind: "remote", deskId: "desk_1" },
      deskId: "desk_1",
      folder: "/tmp/repo",
      cloudRepoUrls: [],
      skipCloudRepoDefaults: true,
    }),
    {
      source: "desk",
      start: "inline",
      kernel: "agentscope",
      repoUrls: ["/tmp/repo"],
      skipRepoDefaults: false,
      target: { loop: "cloud", tools: "desk", deskId: "desk_1", remoteControl: true },
    },
  );
});

test("targetPickerOptions: Web only Cloud; Desk adds This Computer and Remote Control", () => {
  assert.deepEqual(targetPickerOptions({ canRunLocal: false, remoteAvailable: true }), [
    { value: "cloud", label: "云端" },
  ]);
  assert.deepEqual(targetPickerOptions({ canRunLocal: true, remoteAvailable: true }), [
    { value: "cloud", label: "云端" },
    { value: "desk", label: "This Computer" },
    { value: "remote", label: "Remote Control" },
  ]);
  const grey = targetPickerOptions({ canRunLocal: true, remoteAvailable: false });
  assert.equal(grey[2]?.value, "remote");
  assert.equal(grey[2]?.disabled, true);
});

test("localCreateHint names the Desk mode", () => {
  assert.equal(localCreateHint("desk", "/tmp/app"), "This Computer · /tmp/app");
  assert.equal(localCreateHint("remote", ""), REMOTE_FOLDER_HINT);
});

test("withDeskClient marks Desk traffic without a custom header", () => {
  assert.equal(withDeskClient("/v1/me"), "/v1/me?client=desk");
  assert.equal(withDeskClient("/v1/runs?limit=80"), "/v1/runs?limit=80&client=desk");
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

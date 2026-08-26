import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  copyTreeAll,
  materializeRepos,
  measureWorkspaceBytes,
  persistDurableWorkspace,
  persistWorkspaceTree,
  repoName,
  resolveRepoRef,
  skipCopy,
} from "./workspace.js";

const root = fileURLToPath(new URL("../../../..", import.meta.url));

test("resolves GitHub shorthand and local fixture paths", () => {
  const remote = resolveRepoRef("github.com/acme/toy", root);
  assert.equal(remote.kind, "remote");
  assert.equal(remote.source, "https://github.com/acme/toy.git");
  assert.equal(remote.name, "toy");

  const local = resolveRepoRef("fixtures/toy-repo", root);
  assert.equal(local.kind, "local");
  assert.equal(local.source, path.join(root, "fixtures/toy-repo"));
  assert.equal(local.name, "toy-repo");
  assert.equal(repoName("https://github.com/acme/app.git"), "app");
});

test("skipCopy keeps environment.json and drops run workspaces", () => {
  assert.equal(skipCopy("/repo/.neo/environment.json"), false);
  assert.equal(skipCopy("/repo/.neo/runs/abc/hello.txt"), true);
  assert.equal(skipCopy("/repo/.neo/firecracker/vsock.sock"), true);
  assert.equal(skipCopy("/repo/.neo/vms/slot-0.ext4"), true);
  assert.equal(skipCopy("/repo/node_modules/pkg"), true);
  assert.equal(skipCopy("/repo/.control/run.json"), true);
  assert.equal(skipCopy("/repo/.builds/abc/workspace/hello.txt"), true);
  assert.equal(skipCopy("/repo/.warm/abc/slot/hello.txt"), true);
  assert.equal(skipCopy("/repo/.firecracker/overlay/sbin/init"), true);
  assert.equal(skipCopy("/repo/.git/HEAD"), false);
  assert.equal(
    skipCopy("/tmp/runs/.builds/id/workspace/.neo-installed", "/tmp/runs/.builds/id/workspace"),
    false,
  );
  assert.equal(
    skipCopy("/tmp/runs/.builds/id/workspace/node_modules/pkg", "/tmp/runs/.builds/id/workspace"),
    true,
  );
});

test("copies a local fixture into the run workspace", async () => {
  const dest = mkdtempSync(path.join(tmpdir(), "neo-ws-"));
  try {
    const placed = await materializeRepos(["fixtures/toy-repo"], dest, root);
    assert.equal(placed.length, 1);
    assert.equal(readFileSync(path.join(dest, "hello.txt"), "utf8").trim(), "hello from the toy repo");
    assert.equal(readFileSync(path.join(dest, "test.sh"), "utf8").includes("README.md"), true);
    assert.match(readFileSync(path.join(dest, ".neo/environment.json"), "utf8"), /install/);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("persistWorkspaceTree copies slot children and skips lost+found", async () => {
  const src = mkdtempSync(path.join(tmpdir(), "neo-persist-src-"));
  const dest = mkdtempSync(path.join(tmpdir(), "neo-persist-dest-"));
  mkdirSync(path.join(src, "lost+found"), { recursive: true });
  writeFileSync(path.join(src, "lost+found", "x"), "nope\n");
  writeFileSync(path.join(src, "AGENT.md"), "from slot\n");
  writeFileSync(path.join(dest, "AGENT.md"), "stale\n");
  await persistWorkspaceTree(src, dest);
  assert.equal(readFileSync(path.join(dest, "AGENT.md"), "utf8"), "from slot\n");
  assert.equal(existsSync(path.join(dest, "lost+found")), false);
});

test("persistDurableWorkspace skips caches, copies user files, and prunes stale dest", async () => {
  const src = mkdtempSync(path.join(tmpdir(), "neo-durable-src-"));
  const dest = mkdtempSync(path.join(tmpdir(), "neo-durable-dest-"));
  mkdirSync(path.join(src, "node_modules", "pkg"), { recursive: true });
  mkdirSync(path.join(src, "src"), { recursive: true });
  writeFileSync(path.join(src, "node_modules", "pkg", "index.js"), "cache\n");
  writeFileSync(path.join(src, "NOTES.md"), "keep me\n");
  writeFileSync(path.join(src, "src", "app.ts"), "export {}\n");
  writeFileSync(path.join(dest, "stale.txt"), "gone\n");
  mkdirSync(path.join(dest, "node_modules"), { recursive: true });
  writeFileSync(path.join(dest, "node_modules", "old.js"), "old\n");
  await persistDurableWorkspace(src, dest);
  assert.equal(readFileSync(path.join(dest, "NOTES.md"), "utf8"), "keep me\n");
  assert.equal(readFileSync(path.join(dest, "src", "app.ts"), "utf8"), "export {}\n");
  assert.equal(existsSync(path.join(dest, "node_modules")), false);
  assert.equal(existsSync(path.join(dest, "stale.txt")), false);
  assert.equal(measureWorkspaceBytes(src) > 0, true);
  assert.equal(measureWorkspaceBytes(dest), measureWorkspaceBytes(src));
});

test("copyTreeAll keeps install output that skipCopy would drop", async () => {
  const src = mkdtempSync(path.join(tmpdir(), "neo-tree-src-"));
  const dest = path.join(mkdtempSync(path.join(tmpdir(), "neo-tree-dest-")), "ws");
  mkdirSync(path.join(src, "node_modules", "pkg"), { recursive: true });
  writeFileSync(path.join(src, "hello.txt"), "hi\n");
  writeFileSync(path.join(src, "node_modules", "pkg", "index.js"), "ok\n");
  try {
    await copyTreeAll(src, dest);
    assert.equal(readFileSync(path.join(dest, "hello.txt"), "utf8"), "hi\n");
    assert.equal(readFileSync(path.join(dest, "node_modules", "pkg", "index.js"), "utf8"), "ok\n");
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});

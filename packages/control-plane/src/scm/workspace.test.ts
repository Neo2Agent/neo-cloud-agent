import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { materializeRepos, repoName, resolveRepoRef, skipCopy } from "./workspace.js";

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
  assert.equal(skipCopy("/repo/node_modules/pkg"), true);
  assert.equal(skipCopy("/repo/.control/run.json"), true);
  assert.equal(skipCopy("/repo/.builds/abc/workspace/hello.txt"), true);
  assert.equal(skipCopy("/repo/.warm/abc/slot/hello.txt"), true);
  assert.equal(skipCopy("/repo/.firecracker/overlay/sbin/init"), true);
  assert.equal(skipCopy("/repo/.git/HEAD"), false);
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

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createServer } from "node:http";
import { runGit } from "./git.js";
import {
  CLONE_DEST_BUSY,
  formatCloneFailedTitle,
  formatGitCloneTimeoutError,
  gitCloneArgs,
  GIT_CLONE_HTTP_VERSION,
  GIT_CLONE_MAX_ATTEMPTS,
  GIT_CLONE_TIMEOUT_MS,
  isTransientGitCloneError,
  copyTreeAll,
  gitClone,
  gitCloneTimeoutMs,
  materializeRepos,
  measureWorkspaceBytes,
  persistDurableWorkspace,
  persistWorkspaceTree,
  repoName,
  resetUnboundRepoDests,
  resolveRepoRef,
  skipCopy,
  workspaceMatchesBoundRepos,
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
  assert.equal(resolveRepoRef("file:///tmp/not-a-repo", root).kind, "local");
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

async function fileRemoteFromToy(): Promise<{ url: string; cleanup: () => void }> {
  const src = mkdtempSync(path.join(tmpdir(), "neo-ws-src-"));
  const bare = mkdtempSync(path.join(tmpdir(), "neo-ws-bare-"));
  await copyTreeAll(path.join(root, "fixtures/toy-repo"), src);
  await runGit(src, ["init", "-b", "main"]);
  await runGit(src, ["add", "-A"]);
  await runGit(src, ["commit", "-m", "init"]);
  await runGit(bare, ["init", "--bare", "-b", "main"]);
  await runGit(src, ["remote", "add", "origin", bare]);
  await runGit(src, ["push", "origin", "HEAD:main"]);
  return {
    url: pathToFileURL(bare).href,
    cleanup: () => {
      rmSync(src, { recursive: true, force: true });
      rmSync(bare, { recursive: true, force: true });
    },
  };
}

test("materializeRepos clones into a dest that already has Neo overlay", async () => {
  const remote = await fileRemoteFromToy();
  const dest = mkdtempSync(path.join(tmpdir(), "neo-ws-overlay-"));
  try {
    mkdirSync(path.join(dest, ".neo"), { recursive: true });
    writeFileSync(path.join(dest, ".neo", "plugins.json"), '{"plugins":[]}\n');
    const placed = await materializeRepos([remote.url], dest, root);
    assert.equal(placed.length, 1);
    assert.equal(existsSync(path.join(dest, ".git")), true);
    assert.equal(readFileSync(path.join(dest, ".neo", "plugins.json"), "utf8"), '{"plugins":[]}\n');
    assert.equal(readFileSync(path.join(dest, "hello.txt"), "utf8").includes("toy repo"), true);
  } finally {
    remote.cleanup();
    rmSync(dest, { recursive: true, force: true });
  }
});

test("workspaceMatchesBoundRepos checks origin for remotes and files for local", async () => {
  const dest = mkdtempSync(path.join(tmpdir(), "neo-ws-match-"));
  try {
    assert.equal(await workspaceMatchesBoundRepos(dest, [], root), true);
    assert.equal(await workspaceMatchesBoundRepos(dest, ["fixtures/toy-repo"], root), false);
    await materializeRepos(["fixtures/toy-repo"], dest, root);
    assert.equal(await workspaceMatchesBoundRepos(dest, ["fixtures/toy-repo"], root), true);

    const remote = await fileRemoteFromToy();
    const remoteDest = mkdtempSync(path.join(tmpdir(), "neo-ws-origin-"));
    try {
      rmSync(remoteDest, { recursive: true, force: true });
      await gitClone(remote.url, remoteDest);
      assert.equal(await workspaceMatchesBoundRepos(remoteDest, [remote.url], root), true);
      assert.equal(
        await workspaceMatchesBoundRepos(remoteDest, ["https://github.com/acme/other.git"], root),
        false,
      );
      await resetUnboundRepoDests(remoteDest, ["https://github.com/acme/other.git"], root);
      assert.equal(existsSync(path.join(remoteDest, ".git")), false);
    } finally {
      remote.cleanup();
      rmSync(remoteDest, { recursive: true, force: true });
    }
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("gitClone skips when dest already has a matching remote", async () => {
  const remote = await fileRemoteFromToy();
  const dest = mkdtempSync(path.join(tmpdir(), "neo-ws-skip-"));
  try {
    rmSync(dest, { recursive: true, force: true });
    await gitClone(remote.url, dest);
    writeFileSync(path.join(dest, "LOCAL.txt"), "keep\n");
    await gitClone(remote.url, dest);
    assert.equal(readFileSync(path.join(dest, "LOCAL.txt"), "utf8"), "keep\n");
  } finally {
    remote.cleanup();
    rmSync(dest, { recursive: true, force: true });
  }
});

test("gitClone refuses unknown leftover files without leaking the dest path", async () => {
  const dest = mkdtempSync(path.join(tmpdir(), "neo-ws-busy-"));
  writeFileSync(path.join(dest, "NOTES.md"), "user file\n");
  await assert.rejects(() => gitClone("https://github.com/acme/app.git", dest), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, CLONE_DEST_BUSY);
    assert.equal(error.message.includes(dest), false);
    return true;
  });
  rmSync(dest, { recursive: true, force: true });
});

test("clone timeout errors name the repo, budget, and stderr", () => {
  assert.equal(GIT_CLONE_TIMEOUT_MS, 180_000);
  assert.equal(GIT_CLONE_MAX_ATTEMPTS, 2);
  assert.equal(gitCloneTimeoutMs() >= 1, true);
  const error = formatGitCloneTimeoutError("https://github.com/acme/app.git", 180_000, "fatal: unable to access");
  assert.match(error.message, /180000ms/);
  assert.match(error.message, /github.com\/acme\/app/);
  assert.match(error.message, /unable to access/);
  assert.equal(formatCloneFailedTitle(error.message, ["https://github.com/acme/app.git"]), "仓库克隆超时：app，已等待 180 秒。");
});

test("transient GitHub peer resets get a retry title and HTTP/1.1 clone args", () => {
  assert.equal(isTransientGitCloneError("fatal: Failure when receiving data from the peer"), true);
  assert.equal(isTransientGitCloneError("GnuTLS recv error (-110): The TLS connection was non-properly terminated."), true);
  assert.equal(isTransientGitCloneError("permission denied"), false);
  assert.equal(
    formatCloneFailedTitle("fatal: Failure when receiving data from the peer", ["https://github.com/kaibairen/my-working-party.git"]),
    "仓库克隆中断：my-working-party，GitHub 连接被重置，请重试。",
  );
  assert.deepEqual(gitCloneArgs("https://github.com/acme/app.git", "/tmp/app"), [
    "-c",
    `http.version=${GIT_CLONE_HTTP_VERSION}`,
    "clone",
    "--depth",
    "1",
    "https://github.com/acme/app.git",
    "/tmp/app",
  ]);
});

test("gitClone retries a hung remote once before timing out", async () => {
  let hits = 0;
  const server = createServer(() => {
    hits += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const dest = mkdtempSync(path.join(tmpdir(), "neo-ws-timeout-"));
  rmSync(dest, { recursive: true, force: true });
  try {
    await assert.rejects(
      () => gitClone(`http://127.0.0.1:${port}/slow.git`, dest, 400),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /timed out after 400ms/);
        assert.match(error.message, /127\.0\.0\.1/);
        return true;
      },
    );
    assert.ok(hits >= GIT_CLONE_MAX_ATTEMPTS);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    rmSync(dest, { recursive: true, force: true });
  }
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

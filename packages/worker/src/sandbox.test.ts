import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  fileToolEscapes,
  fileToolWritesProtectedPath,
  protectedWorkspacePath,
  shellWriteEscapes,
  shellWriteHitsProtectedPath,
} from "./sandbox.js";

const root = "/home/me/code/app";

test("file tools may only touch paths under the workspace", () => {
  assert.equal(fileToolEscapes(root, "read", { path: "src/foo.ts" }), false);
  assert.equal(fileToolEscapes(root, "read", { path: `${root}/src/foo.ts` }), false);
  assert.equal(fileToolEscapes(root, "write", { path: "./notes.md" }), false);
  assert.equal(fileToolEscapes(root, "read", { path: "/etc/passwd" }), true);
  assert.equal(fileToolEscapes(root, "read", { path: "../../secrets.txt" }), true);
  assert.equal(fileToolEscapes(root, "write", { path: "~/.ssh/id_rsa" }), true);
  assert.equal(fileToolEscapes(root, "edit", { path: "/home/me/code/other/x.ts" }), true);
});

test("tools without a path argument are left alone", () => {
  assert.equal(fileToolEscapes(root, "bash", { command: "ls /etc" }), false);
  assert.equal(fileToolEscapes(root, "neo_git_commit", { message: "wip" }), false);
  assert.equal(fileToolEscapes(root, "read", {}), false);
});

test("shell writes outside the workspace are refused", () => {
  assert.equal(shellWriteEscapes(root, "echo hi > notes.txt"), null);
  assert.equal(shellWriteEscapes(root, "npm test 2>/dev/null"), null);
  assert.equal(shellWriteEscapes(root, "cat src/foo.ts"), null);
  assert.equal(shellWriteEscapes(root, "rm -rf build"), null);
  assert.equal(shellWriteEscapes(root, "echo pwned > /etc/hosts"), "/etc/hosts");
  assert.equal(shellWriteEscapes(root, "rm -rf ~/Documents"), "~/Documents");
  assert.equal(shellWriteEscapes(root, "npm test && mv src/foo.ts /tmp/../etc/foo"), "/tmp/../etc/foo");
});

test("the system temp dir stays writable so build tooling still works", () => {
  const tmp = path.join(tmpdir(), "build-cache");
  assert.equal(shellWriteEscapes(root, `echo x > ${tmp}`), null);
  assert.equal(shellWriteEscapes(root, `rm -rf ${tmp}`), null);
});

test("reads through the shell are not blocked, only writes", () => {
  // The hard read boundary is on the file tools; a shell read is not worth
  // breaking every `cat /usr/share/...` over.
  assert.equal(shellWriteEscapes(root, "cat /etc/hostname"), null);
  assert.equal(shellWriteEscapes(root, "/usr/bin/env node -v"), null);
});

test("git hooks and config stay read-only even inside the workspace", () => {
  // These outlive the turn: a hook runs on the user's next commit, and config
  // can repoint origin or core.hooksPath.
  assert.equal(protectedWorkspacePath(root, `${root}/.git/hooks/pre-commit`), ".git/hooks");
  assert.equal(protectedWorkspacePath(root, `${root}/.git/config`), ".git/config");
  assert.equal(protectedWorkspacePath(root, `${root}/.git/info/attributes`), ".git/info/attributes");
  assert.equal(protectedWorkspacePath(root, `${root}/.neo/runs/run-a/EXPERT.md`), ".neo");
  // The rest of .git, and the repo itself, are not protected by this rule.
  assert.equal(protectedWorkspacePath(root, `${root}/.git/info/exclude`), null);
  assert.equal(protectedWorkspacePath(root, `${root}/src/foo.ts`), null);
  assert.equal(protectedWorkspacePath(root, "/etc/passwd"), null);
});

test("writing a protected path through a file tool is refused, reading it is not", () => {
  assert.equal(fileToolWritesProtectedPath(root, "write", { path: ".git/hooks/pre-push" }), ".git/hooks");
  assert.equal(fileToolWritesProtectedPath(root, "edit", { path: `${root}/.git/config` }), ".git/config");
  assert.equal(fileToolWritesProtectedPath(root, "write", { path: ".neo/runs/run-b/EXPERT.md" }), ".neo");
  assert.equal(fileToolWritesProtectedPath(root, "read", { path: ".git/config" }), null);
  assert.equal(fileToolWritesProtectedPath(root, "grep", { path: ".git/hooks" }), null);
  assert.equal(fileToolWritesProtectedPath(root, "write", { path: "src/foo.ts" }), null);
});

test("a shell write into a protected path is refused, however it is spelled", () => {
  // Both halves come back: what the agent typed, and which rule it hit.
  assert.deepEqual(shellWriteHitsProtectedPath(root, "echo x > .git/hooks/pre-commit"), {
    token: ".git/hooks/pre-commit",
    guarded: ".git/hooks",
  });
  assert.deepEqual(shellWriteHitsProtectedPath(root, "rm -rf .git/hooks"), {
    token: ".git/hooks",
    guarded: ".git/hooks",
  });
  assert.deepEqual(shellWriteHitsProtectedPath(root, `cp evil ${root}/.git/config`), {
    token: `${root}/.git/config`,
    guarded: ".git/config",
  });
  assert.equal(shellWriteHitsProtectedPath(root, "chmod +x .git/hooks/pre-commit")?.guarded, ".git/hooks");
  assert.equal(shellWriteHitsProtectedPath(root, "rm -rf .neo/runs")?.guarded, ".neo");
  // Ordinary work in the repo, and git's own writes, are untouched.
  assert.equal(shellWriteHitsProtectedPath(root, "rm -rf build"), null);
  assert.equal(shellWriteHitsProtectedPath(root, "git commit -am wip"), null);
  assert.equal(shellWriteHitsProtectedPath(root, "git config user.name me"), null);
  assert.equal(shellWriteHitsProtectedPath(root, "cat .git/config"), null);
});

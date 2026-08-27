import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileToolEscapes, shellWriteEscapes } from "./sandbox.js";

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

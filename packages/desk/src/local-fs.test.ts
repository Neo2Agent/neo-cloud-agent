import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { listLocalPath, resolveInsideRoot, writeLocalFile } from "./local-fs.js";

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "neo-local-fs-"));
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "node_modules"));
  mkdirSync(path.join(root, ".git"));
  writeFileSync(path.join(root, "README.md"), "hello\n");
  writeFileSync(path.join(root, "src", "foo.ts"), "export const foo = 1;\n");
  return root;
}

test("listing a folder skips noise and sorts folders first", () => {
  const root = fixture();
  const listing = listLocalPath(root);
  assert.equal(listing.type, "dir");
  const names = (listing.entries ?? []).map((item) => item.name);
  assert.equal(names.includes("node_modules"), false);
  assert.equal(names.includes(".git"), false);
  assert.deepEqual(names, ["src", "README.md"]);
});

test("a file returns its content only when asked", () => {
  const root = fixture();
  assert.equal(listLocalPath(root, "README.md").content, undefined);
  const file = listLocalPath(root, "README.md", { content: true });
  assert.equal(file.type, "file");
  assert.equal(file.content, "hello\n");
  assert.equal(file.truncated, false);
});

test("nested paths stay relative to the workspace root", () => {
  const root = fixture();
  const listing = listLocalPath(root, "src");
  assert.equal(listing.path, "src");
  assert.deepEqual((listing.entries ?? []).map((item) => item.path), ["src/foo.ts"]);
});

test("nothing outside the workspace can be read", () => {
  const root = fixture();
  assert.throws(() => listLocalPath(root, "../"), /超出/);
  assert.throws(() => listLocalPath(root, "/etc/passwd"), /超出/);
  assert.throws(() => resolveInsideRoot(root, "../../etc/passwd"), /超出/);
  assert.equal(resolveInsideRoot(root, "src/foo.ts"), path.join(root, "src/foo.ts"));
});

test("new files stay inside the workspace and pick an unused name", () => {
  const root = fixture();
  const created = writeLocalFile(root, "notes.md", "hi\n");
  assert.equal(created.path, "notes.md");
  assert.equal(listLocalPath(root, "notes.md", { content: true }).content, "hi\n");
  assert.throws(() => writeLocalFile(root, "../escape.md"), /超出/);
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { listWorkspacePath } from "./workspace-fs.js";

test("lists a workspace directory and rejects path escape", () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-fs-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(path.join(root, "README.md"), "# hi\n");
  writeFileSync(path.join(root, "src", "app.ts"), "export {}\n");
  writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "ok\n");

  const listing = listWorkspacePath(root, "");
  assert.equal(listing.type, "dir");
  assert.deepEqual(
    listing.entries?.map((item) => item.name),
    ["src", "README.md"],
  );

  const file = listWorkspacePath(root, "README.md", { content: true });
  assert.equal(file.type, "file");
  assert.match(file.content ?? "", /# hi/);

  assert.throws(() => listWorkspacePath(root, "../secret"), /escapes workspace/);
});

test("lists an empty directory when the workspace root is missing", () => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), "neo-fs-missing-")), "gone");
  const listing = listWorkspacePath(root, "");
  assert.equal(listing.type, "dir");
  assert.deepEqual(listing.entries, []);
});

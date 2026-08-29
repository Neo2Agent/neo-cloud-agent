import assert from "node:assert/strict";
import test from "node:test";
import { fileKind, nextUntitledName, sortFsEntries } from "./file-kind.js";

test("folders sort above files and keep a stable kind", () => {
  assert.equal(fileKind("docs", "dir"), "dir");
  assert.deepEqual(
    sortFsEntries([
      { name: "README.md", type: "file" },
      { name: "docs", type: "dir" },
      { name: "AGENTS.md", type: "file" },
    ]).map((item) => item.name),
    ["docs", "AGENTS.md", "README.md"],
  );
});

test("common project files get a distinct glyph", () => {
  assert.equal(fileKind("package.json", "file"), "json");
  assert.equal(fileKind("pnpm-lock.yaml", "file"), "lock");
  assert.equal(fileKind(".gitignore", "file"), "git");
  assert.equal(fileKind("README.md", "file"), "md");
  assert.equal(fileKind("app.tsx", "file"), "ts");
});

test("untitled names skip ones already in the folder", () => {
  assert.equal(nextUntitledName([{ name: "README.md" }]), "untitled.md");
  assert.equal(nextUntitledName([{ name: "untitled.md" }]), "untitled-2.md");
});

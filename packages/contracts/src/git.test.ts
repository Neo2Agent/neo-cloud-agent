import assert from "node:assert/strict";
import test from "node:test";
import {
  capPatch,
  GIT_LOG_FORMAT,
  groupCommitsByDay,
  mergeFileChanges,
  parseGitLog,
  parseHunkLines,
  parseNameStatus,
  parseNumstat,
  runGitContext,
  splitPatchByFile,
} from "./git.js";

test("runGitContext hides Git for plain chats and splits cloud from desk", () => {
  assert.equal(runGitContext({ repoUrls: [], branchName: null, pullRequests: [] }), "none");
  assert.equal(runGitContext({ repoUrls: ["https://github.com/o/r"], branchName: null }), "cloud");
  assert.equal(runGitContext({ repoUrls: [], branchName: "neo/fix-1234abcd" }), "cloud");
  assert.equal(
    runGitContext({ repoUrls: ["/Users/me/repo"], executionTarget: { loop: "desk", tools: "desk", deskId: "desk_1" } }),
    "desk",
  );
  assert.equal(
    runGitContext({
      repoUrls: [],
      executionTarget: { loop: "cloud", tools: "desk", deskId: "desk_1", remoteControl: true },
    }),
    "desk",
  );
});

test("numstat and name-status merge into one file list with untracked files", () => {
  const stats = parseNumstat("3\t1\tsrc/a.ts\n-\t-\timg.png\n5\t0\tsrc/{old => new}/b.ts\n");
  assert.deepEqual(stats.get("src/a.ts"), { added: 3, removed: 1, binary: false });
  assert.deepEqual(stats.get("img.png"), { added: 0, removed: 0, binary: true });
  assert.deepEqual(stats.get("src/new/b.ts"), { added: 5, removed: 0, binary: false });
  const names = parseNameStatus("M\tsrc/a.ts\nA\timg.png\nR100\tsrc/old/b.ts\tsrc/new/b.ts\nD\tgone.txt\n");
  const files = mergeFileChanges(names, stats, [{ path: "notes.md", added: 2 }]);
  assert.deepEqual(
    files.map((item) => `${item.status}:${item.path}:+${item.added}-${item.removed}`),
    ["deleted:gone.txt:+0-0", "added:img.png:+0-0", "untracked:notes.md:+2-0", "modified:src/a.ts:+3-1", "renamed:src/new/b.ts:+5-0"],
  );
  assert.equal(files.find((item) => item.status === "renamed")?.oldPath, "src/old/b.ts");
});

test("parseGitLog reads the log format back with per-commit numstat", () => {
  const sep = GIT_LOG_FORMAT.slice(0, 1);
  const field = "\u001f";
  const output = [
    `${sep}aaaaaaaa1111111111111111111111111111aaaa${field}Neo${field}2026-09-23T10:00:00+08:00${field}feat: add a`,
    "",
    "3\t1\tsrc/a.ts",
    "2\t0\tREADME.md",
    `${sep}bbbbbbbb2222222222222222222222222222bbbb${field}Neo${field}2026-09-22T10:00:00+08:00${field}fix: b`,
    "",
    "0\t4\tsrc/b.ts",
  ].join("\n");
  const commits = parseGitLog(output);
  assert.equal(commits.length, 2);
  assert.deepEqual(
    { message: commits[0]?.message, added: commits[0]?.added, removed: commits[0]?.removed, files: commits[0]?.files },
    { message: "feat: add a", added: 5, removed: 1, files: 2 },
  );
  assert.equal(commits[1]?.removed, 4);
  const days = groupCommitsByDay(commits);
  assert.deepEqual(days.map((day) => day.day), ["2026年9月23日", "2026年9月22日"]);
});

test("splitPatchByFile and capPatch keep per-file bodies and a byte ceiling", () => {
  const patch = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "diff --git a/notes.md b/notes.md",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/notes.md",
    "@@ -0,0 +1 @@",
    "+hi",
    "",
  ].join("\n");
  assert.deepEqual(splitPatchByFile(patch).map((item) => item.path), ["src/a.ts", "notes.md"]);
  const capped = capPatch("line\n".repeat(100), 64);
  assert.equal(capped.truncated, true);
  assert.ok(capped.patch.length <= 64);
  assert.equal(capPatch("small", 64).truncated, false);
});

test("parseHunkLines assigns old and new line numbers across ctx, del, and add", () => {
  const patch = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,4 +1,5 @@",
    " keep",
    "-old",
    "+new",
    "+extra",
    " tail",
    "@@ -20,2 +21,2 @@ later",
    "-gone",
    "+here",
  ].join("\n");
  assert.deepEqual(parseHunkLines(patch), [
    { type: "hunk", text: "@@ -1,4 +1,5 @@" },
    { type: "ctx", text: "keep", oldLine: 1, newLine: 1 },
    { type: "del", text: "old", oldLine: 2 },
    { type: "add", text: "new", newLine: 2 },
    { type: "add", text: "extra", newLine: 3 },
    { type: "ctx", text: "tail", oldLine: 3, newLine: 4 },
    { type: "hunk", text: "@@ -20,2 +21,2 @@ later" },
    { type: "del", text: "gone", oldLine: 20 },
    { type: "add", text: "here", newLine: 21 },
  ]);
});

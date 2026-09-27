import assert from "node:assert/strict";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { mobileSidebarGroups, projectNameMap } from "./sidebar-folders.js";

function run(partial: Partial<Run> & { id: string }): Run {
  return {
    prompt: "hi",
    status: "IDLE",
    createdAt: "2026-08-23T10:00:00.000Z",
    updatedAt: "2026-08-23T10:00:00.000Z",
    ...partial,
  } as Run;
}

test("projectNameMap keeps the same ids the sidebar folders read", () => {
  assert.deepEqual(projectNameMap([{ id: "p1", name: "官网" }]), { p1: "官网" });
});

test("mobileSidebarGroups splits projects, repos, chat, and archived", () => {
  const groups = mobileSidebarGroups(
    [
      run({ id: "proj", projectId: "p1" }),
      run({ id: "repo", repoUrls: ["https://github.com/acme/app.git"] }),
      run({ id: "chat" }),
      run({ id: "old", status: "ARCHIVED" }),
    ],
    { p1: "官网" },
  );
  assert.equal(groups.folders[0]?.label, "官网");
  assert.deepEqual(groups.folders[0]?.recent.map((item) => item.id), ["proj"]);
  assert.equal(groups.repos[0]?.label, "acme/app");
  assert.deepEqual(groups.chat.map((item) => item.id), ["chat"]);
  assert.deepEqual(groups.shelved.map((item) => item.id), ["old"]);
});

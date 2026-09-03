import assert from "node:assert/strict";
import test from "node:test";
import type { InboxItem } from "@neo-cloud-agent/contracts/project-message";
import {
  canLoadOlder,
  canSaveArtifact,
  filterMemories,
  filterPlugins,
  inboxKindLabel,
  inboxTarget,
  isShelvedRun,
  memoryHint,
  pluginActionLabel,
  saveArtifactHint,
  sortInbox,
  splitShelvedRuns,
  toggleSelected,
  unreadBadge,
} from "./cloud.js";

function inbox(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: "inb_1",
    userId: "u1",
    kind: "transfer",
    title: "有人给你转了一条对话",
    projectId: null,
    runId: null,
    todoId: null,
    messageId: null,
    read: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

test("memoryHint separates not-configured from empty", () => {
  assert.match(memoryHint({ configured: false, count: 0 }), /还没接上/);
  assert.match(memoryHint({ configured: true, count: 0 }), /还没有记忆/);
  assert.match(memoryHint({ configured: true, count: 3 }), /已记住 3 条/);
  assert.equal(memoryHint({ configured: true, count: 3, error: "mem0 挂了" }), "mem0 挂了");
});

test("filterMemories matches text", () => {
  const items = [{ id: "m1", text: "用 pnpm test" }, { id: "m2", text: "默认开 draft PR" }];
  assert.deepEqual(filterMemories(items, "pnpm").map((item) => item.id), ["m1"]);
  assert.equal(filterMemories(items, "  ").length, 2);
});

test("unreadBadge caps at 9+ like the web bell", () => {
  assert.equal(unreadBadge(0), "");
  assert.equal(unreadBadge(-1), "");
  assert.equal(unreadBadge(4), "4");
  assert.equal(unreadBadge(12), "9+");
});

test("inboxTarget prefers the run so a transfer opens the conversation", () => {
  assert.deepEqual(inboxTarget(inbox({ runId: "r1", projectId: "p1" })), { screen: "chat", runId: "r1" });
  assert.deepEqual(inboxTarget(inbox({ projectId: "p1" })), { screen: "projects", projectId: "p1" });
  assert.equal(inboxTarget(inbox({})), null);
});

test("sortInbox puts unread first, then newest", () => {
  const items = [
    inbox({ id: "a", read: true, createdAt: "2026-09-01T03:00:00.000Z" }),
    inbox({ id: "b", read: false, createdAt: "2026-09-01T01:00:00.000Z" }),
    inbox({ id: "c", read: false, createdAt: "2026-09-01T02:00:00.000Z" }),
  ];
  assert.deepEqual(sortInbox(items).map((item) => item.id), ["c", "b", "a"]);
});

test("inboxKindLabel covers every kind the control plane writes", () => {
  const kinds: InboxItem["kind"][] = ["invite_pending", "invited", "todo_assigned", "mention", "transfer"];
  for (const kind of kinds) {
    assert.equal(inboxKindLabel(kind).length > 0, true);
  }
});

test("saving an artifact needs a project run", () => {
  assert.equal(canSaveArtifact({ projectId: "p1" }), true);
  assert.equal(canSaveArtifact({ projectId: null }), false);
  assert.equal(canSaveArtifact(null), false);
  assert.match(saveArtifactHint(null), /只有项目对话/);
  assert.equal(saveArtifactHint({ projectId: "p1" }), "");
});

test("plugin action follows installed then enabled", () => {
  assert.equal(pluginActionLabel({ installed: false, enabled: false }), "安装");
  assert.equal(pluginActionLabel({ installed: true, enabled: false }), "启用");
  assert.equal(pluginActionLabel({ installed: true, enabled: true }), "停用");
});

test("filterPlugins matches name or description", () => {
  const items = [
    { name: "PR 审查", description: "按严重级给意见" },
    { name: "发布说明", description: "从提交写 changelog" },
  ] as Parameters<typeof filterPlugins>[0];
  assert.equal(filterPlugins(items, "审查").length, 1);
  assert.equal(filterPlugins(items, "changelog").length, 1);
  assert.equal(filterPlugins(items, "").length, 2);
});

test("only archived and expired runs are shelved", () => {
  assert.equal(isShelvedRun("ARCHIVED"), true);
  assert.equal(isShelvedRun("EXPIRED"), true);
  assert.equal(isShelvedRun("IDLE"), false);
  const split = splitShelvedRuns([{ status: "IDLE" }, { status: "ARCHIVED" }, { status: "RUNNING" }]);
  assert.equal(split.live.length, 2);
  assert.equal(split.shelved.length, 1);
});

test("toggleSelected adds then removes", () => {
  assert.deepEqual(toggleSelected([], "r1"), ["r1"]);
  assert.deepEqual(toggleSelected(["r1", "r2"], "r1"), ["r2"]);
});

test("canLoadOlder needs both a cursor and a remaining count", () => {
  assert.equal(canLoadOlder({ remaining: 12, nextBefore: "e9" }), true);
  assert.equal(canLoadOlder({ remaining: 0, nextBefore: "e9" }), false);
  assert.equal(canLoadOlder({ remaining: 12, nextBefore: null }), false);
  assert.equal(canLoadOlder(null), false);
});

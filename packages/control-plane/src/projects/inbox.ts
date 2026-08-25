import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { InboxItem, InboxKind } from "@neo-cloud-agent/contracts/project-message";
import { controlStateDir } from "../store/persist.js";

let memo: { file: string; items: InboxItem[] } | null = null;

function inboxFile(): string {
  return path.join(controlStateDir(), "inbox.json");
}

function readAll(): InboxItem[] {
  const file = inboxFile();
  if (memo?.file === file) return memo.items;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { items?: InboxItem[] };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    memo = { file, items };
    return items;
  } catch {
    memo = { file, items: [] };
    return memo.items;
  }
}

function writeAll(items: InboxItem[]): void {
  const file = inboxFile();
  memo = { file, items };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 1, items }, null, 2)}\n`, { mode: 0o600 });
}

export function pushInbox(input: {
  userId: string;
  kind: InboxKind;
  title: string;
  projectId?: string | null;
  runId?: string | null;
  todoId?: string | null;
  messageId?: string | null;
}): InboxItem {
  const item: InboxItem = {
    id: `inb_${randomUUID().slice(0, 8)}`,
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    projectId: input.projectId ?? null,
    runId: input.runId ?? null,
    todoId: input.todoId ?? null,
    messageId: input.messageId ?? null,
    read: false,
    createdAt: new Date().toISOString(),
  };
  writeAll([item, ...readAll()].slice(0, 400));
  return item;
}

export function listInbox(userId: string): InboxItem[] {
  return readAll().filter((item) => item.userId === userId);
}

export function unreadInboxCount(userId: string): number {
  return listInbox(userId).filter((item) => !item.read).length;
}

export function markInboxRead(userId: string, id?: string): void {
  writeAll(
    readAll().map((item) => {
      if (item.userId !== userId) return item;
      if (id && item.id !== id) return item;
      return { ...item, read: true };
    }),
  );
}

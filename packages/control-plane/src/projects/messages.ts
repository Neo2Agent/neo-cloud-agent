import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canManageProject } from "@neo-cloud-agent/contracts";
import type { CreateProjectMessageRequest, ProjectMessage } from "@neo-cloud-agent/contracts/project-message";
import { controlStateDir } from "../store/persist.js";
import { getProject, memberRole, projectHasMember } from "./store.js";
import { pushInbox } from "./inbox.js";

let memo: { file: string; items: ProjectMessage[] } | null = null;

function messagesFile(): string {
  return path.join(controlStateDir(), "project-messages.json");
}

function readAll(): ProjectMessage[] {
  const file = messagesFile();
  if (memo?.file === file) return memo.items;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { messages?: ProjectMessage[] };
    const items = Array.isArray(parsed.messages) ? parsed.messages : [];
    memo = { file, items };
    return items;
  } catch {
    memo = { file, items: [] };
    return memo.items;
  }
}

function writeAll(items: ProjectMessage[]): void {
  const file = messagesFile();
  memo = { file, items };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 1, messages: items }, null, 2)}\n`, { mode: 0o600 });
}

function requireMember(projectId: string, userId: string) {
  const project = getProject(projectId);
  if (!project || !projectHasMember(projectId, userId)) throw new Error("项目不存在");
  return project;
}

function assertMentions(body: string, mentionUserIds: string[], projectId: string): void {
  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");
  for (const userId of mentionUserIds) {
    const member = project.members.find((item) => item.userId === userId);
    if (!member) throw new Error("@ 的人不是项目成员");
    const short = member.email.split("@")[0] ?? member.email;
    if (!body.includes(`@${member.email}`) && !body.includes(`@${short}`)) {
      throw new Error("正文必须写出 @名字");
    }
  }
}

export function listProjectMessages(projectId: string, actorUserId: string): ProjectMessage[] {
  requireMember(projectId, actorUserId);
  return readAll().filter((item) => item.projectId === projectId).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function createProjectMessage(
  projectId: string,
  input: CreateProjectMessageRequest,
  actor: { userId: string; email: string },
): ProjectMessage {
  requireMember(projectId, actor.userId);
  const body = (input.body ?? "").trim();
  if (!body) throw new Error("留言不能为空");
  const mentionUserIds = input.mentionUserIds ?? [];
  assertMentions(body, mentionUserIds, projectId);
  let parentId: string | null = input.parentId ?? null;
  if (parentId) {
    const parent = readAll().find((item) => item.id === parentId && item.projectId === projectId);
    if (!parent) throw new Error("回复的留言不存在");
    if (parent.parentId) throw new Error("只能回复一层");
  }
  const now = new Date().toISOString();
  const message: ProjectMessage = {
    id: `msg_${randomUUID().slice(0, 8)}`,
    projectId,
    parentId,
    body,
    mentionUserIds,
    mentionAll: Boolean(input.mentionAll),
    attachments: input.attachments ?? [],
    createdBy: actor.userId,
    createdEmail: actor.email,
    createdAt: now,
    updatedAt: now,
  };
  writeAll([...readAll(), message]);
  const targets = new Set(mentionUserIds);
  if (input.mentionAll) {
    for (const member of getProject(projectId)?.members ?? []) {
      if (member.userId !== actor.userId) targets.add(member.userId);
    }
  }
  for (const userId of targets) {
    if (userId === actor.userId) continue;
    pushInbox({ userId, kind: "mention", title: `${actor.email} 在项目里提到了你`, projectId, messageId: message.id });
  }
  return message;
}

export function updateProjectMessage(
  projectId: string,
  messageId: string,
  input: CreateProjectMessageRequest,
  actor: { userId: string; email: string },
): ProjectMessage {
  requireMember(projectId, actor.userId);
  const items = readAll();
  const index = items.findIndex((item) => item.id === messageId && item.projectId === projectId);
  const current = items[index];
  if (!current) throw new Error("留言不存在");
  if (current.createdBy !== actor.userId) throw new Error("只能改自己的留言");
  const body = (input.body ?? "").trim();
  if (!body) throw new Error("留言不能为空");
  const mentionUserIds = input.mentionUserIds ?? current.mentionUserIds;
  assertMentions(body, mentionUserIds, projectId);
  const next: ProjectMessage = {
    ...current,
    body,
    mentionUserIds,
    mentionAll: input.mentionAll ?? current.mentionAll,
    attachments: input.attachments ?? current.attachments,
    updatedAt: new Date().toISOString(),
  };
  items[index] = next;
  writeAll(items);
  return next;
}

export function deleteProjectMessage(projectId: string, messageId: string, actor: { userId: string }): void {
  requireMember(projectId, actor.userId);
  const items = readAll();
  const current = items.find((item) => item.id === messageId && item.projectId === projectId);
  if (!current) throw new Error("留言不存在");
  const admin = canManageProject(memberRole(projectId, actor.userId));
  if (current.createdBy !== actor.userId && !admin) throw new Error("没有权限删留言");
  writeAll(items.filter((item) => item.id !== messageId && item.parentId !== messageId));
}

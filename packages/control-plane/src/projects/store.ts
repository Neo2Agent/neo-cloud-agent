import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  canManageProject,
  type InvitePolicy,
  type Project,
  type ProjectEvent,
  type ProjectInvite,
  type ProjectMember,
  type ProjectRole,
} from "@neo-cloud-agent/contracts";
import { controlStateDir } from "../store/persist.js";
import { projectPersistHooks } from "./persist-hooks.js";

const MAX_PROJECTS = 40;
const MAX_MEMBERS = 20;
const MAX_EVENTS = 40;
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function projectsFile(): string {
  return path.join(controlStateDir(), "projects.json");
}

let projectMemo: { file: string; items: Project[] } | null = null;

function readAll(): Project[] {
  const file = projectsFile();
  if (projectMemo?.file === file) {
    return projectMemo.items;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { projects?: unknown };
    const items = Array.isArray(parsed.projects) ? parsed.projects.map(normalize).filter(Boolean) as Project[] : [];
    projectMemo = { file, items };
    return items;
  } catch {
    projectMemo = { file, items: [] };
    return projectMemo.items;
  }
}

function writeAll(items: Project[], options?: { mirror?: boolean }): void {
  const file = projectsFile();
  projectMemo = { file, items };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 1, projects: items }, null, 2)}\n`, { mode: 0o600 });
  if (options?.mirror !== false) {
    projectPersistHooks().onWrite?.(items);
  }
}

export function replaceProjects(items: Project[], options?: { mirror?: boolean }): void {
  writeAll(items.map((item) => normalize(item)).filter((item): item is Project => Boolean(item)), options);
}

function asRole(value: unknown): ProjectRole {
  return value === "admin" || value === "member" || value === "owner" ? value : "member";
}

function asPolicy(value: unknown): InvitePolicy {
  return value === "approve" ? "approve" : "open";
}

function normalize(value: unknown): Project | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record || typeof record.id !== "string" || typeof record.name !== "string") {
    return null;
  }
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
  const members = Array.isArray(record.members)
    ? record.members
        .map((item) => {
          const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
          if (!row || typeof row.userId !== "string" || typeof row.email !== "string") return null;
          return {
            userId: row.userId,
            email: row.email,
            role: asRole(row.role),
            joinedAt: typeof row.joinedAt === "string" ? row.joinedAt : createdAt,
          } satisfies ProjectMember;
        })
        .filter((item): item is ProjectMember => Boolean(item))
    : [];
  const invites = Array.isArray(record.invites)
    ? record.invites
        .map((item) => {
          const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
          if (!row || typeof row.token !== "string") return null;
          const status = row.status;
          const invite: ProjectInvite = {
            token: row.token,
            createdBy: typeof row.createdBy === "string" ? row.createdBy : "",
            createdAt: typeof row.createdAt === "string" ? row.createdAt : createdAt,
            expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : createdAt,
            status:
              status === "accepted" || status === "pending" || status === "rejected" || status === "revoked"
                ? status
                : "active",
            note: typeof row.note === "string" ? row.note : "",
          };
          if (typeof row.requestedBy === "string") invite.requestedBy = row.requestedBy;
          if (typeof row.requestedEmail === "string") invite.requestedEmail = row.requestedEmail;
          return invite;
        })
        .filter((item): item is ProjectInvite => Boolean(item))
    : [];
  const events = Array.isArray(record.events)
    ? record.events
        .map((item) => {
          const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
          if (!row || typeof row.id !== "string" || typeof row.kind !== "string") return null;
          return {
            id: row.id,
            at: typeof row.at === "string" ? row.at : createdAt,
            actorUserId: typeof row.actorUserId === "string" ? row.actorUserId : "",
            actorEmail: typeof row.actorEmail === "string" ? row.actorEmail : "",
            kind: row.kind,
            detail: typeof row.detail === "string" ? row.detail : "",
          } satisfies ProjectEvent;
        })
        .filter((item): item is ProjectEvent => Boolean(item))
    : [];
  const repos = Array.isArray(record.defaultRepoUrls)
    ? record.defaultRepoUrls.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
  return {
    id: record.id,
    name: record.name.trim() || "未命名项目",
    instruction: typeof record.instruction === "string" ? record.instruction : "",
    defaultRepoUrls: repos,
    invitePolicy: asPolicy(record.invitePolicy),
    createdBy: typeof record.createdBy === "string" ? record.createdBy : members[0]?.userId ?? "",
    createdAt,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : createdAt,
    members,
    invites,
    events: events.slice(-MAX_EVENTS),
  };
}

function pushEvent(project: Project, actor: { userId: string; email: string }, kind: string, detail: string): Project {
  const event: ProjectEvent = {
    id: `evt_${randomUUID().slice(0, 8)}`,
    at: new Date().toISOString(),
    actorUserId: actor.userId,
    actorEmail: actor.email,
    kind,
    detail,
  };
  return { ...project, events: [...project.events, event].slice(-MAX_EVENTS), updatedAt: event.at };
}

function save(project: Project): Project {
  const items = readAll();
  const index = items.findIndex((item) => item.id === project.id);
  if (index < 0) items.push(project);
  else items[index] = project;
  writeAll(items);
  return project;
}

export function listProjects(): Project[] {
  return [...readAll()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function listProjectsForUser(userId: string): Project[] {
  return listProjects().filter((item) => item.members.some((member) => member.userId === userId));
}

export function getProject(id: string): Project | null {
  return readAll().find((item) => item.id === id) ?? null;
}

export function projectHasMember(projectId: string, userId: string): boolean {
  return Boolean(memberRole(projectId, userId));
}

export function memberRole(projectId: string, userId: string): ProjectRole | null {
  return getProject(projectId)?.members.find((item) => item.userId === userId)?.role ?? null;
}

export function createProject(input: {
  name: string;
  instruction?: string;
  defaultRepoUrls?: string[];
  invitePolicy?: InvitePolicy;
  actor: { userId: string; email: string };
}): Project {
  const name = input.name.trim();
  if (!name) throw new Error("项目名称不能为空");
  const items = readAll();
  if (items.length >= MAX_PROJECTS) throw new Error(`最多 ${MAX_PROJECTS} 个项目`);
  const now = new Date().toISOString();
  const project: Project = {
    id: `proj_${randomUUID().slice(0, 8)}`,
    name,
    instruction: (input.instruction ?? "").trim(),
    defaultRepoUrls: (input.defaultRepoUrls ?? []).map((item) => item.trim()).filter(Boolean),
    invitePolicy: input.invitePolicy === "approve" ? "approve" : "open",
    createdBy: input.actor.userId,
    createdAt: now,
    updatedAt: now,
    members: [{ userId: input.actor.userId, email: input.actor.email, role: "owner", joinedAt: now }],
    invites: [],
    events: [],
  };
  return save(pushEvent(project, input.actor, "created", `创建了项目「${name}」`));
}

export function updateProject(
  id: string,
  patch: { name?: string; instruction?: string; defaultRepoUrls?: string[]; invitePolicy?: InvitePolicy },
  actor: { userId: string; email: string },
): Project {
  const current = getProject(id);
  if (!current) throw new Error("项目不存在");
  if (!canManageProject(memberRole(id, actor.userId))) throw new Error("没有权限改项目");
  const next = {
    ...current,
    name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
    instruction: patch.instruction !== undefined ? patch.instruction : current.instruction,
    defaultRepoUrls: patch.defaultRepoUrls ?? current.defaultRepoUrls,
    invitePolicy: patch.invitePolicy ?? current.invitePolicy,
  };
  return save(pushEvent(next, actor, "updated", "更新了项目设置"));
}

export function createInvite(projectId: string, actor: { userId: string; email: string }, note = ""): ProjectInvite {
  const current = getProject(projectId);
  if (!current) throw new Error("项目不存在");
  if (!memberRole(projectId, actor.userId)) throw new Error("不是项目成员");
  const invite: ProjectInvite = {
    token: randomBytes(18).toString("base64url"),
    createdBy: actor.userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    status: "active",
    note: note.trim(),
  };
  save(pushEvent({ ...current, invites: [...current.invites, invite] }, actor, "invite", "创建了邀请链接"));
  return invite;
}

export function findInvite(token: string): { project: Project; invite: ProjectInvite } | null {
  for (const project of readAll()) {
    const invite = project.invites.find((item) => item.token === token);
    if (invite) return { project, invite };
  }
  return null;
}

export function acceptInvite(token: string, actor: { userId: string; email: string }): Project {
  const found = findInvite(token);
  if (!found) throw new Error("邀请不存在");
  const { project, invite } = found;
  if (invite.status === "revoked" || invite.status === "rejected") throw new Error("邀请已失效");
  if (Date.parse(invite.expiresAt) <= Date.now()) throw new Error("邀请已过期");
  if (project.members.some((item) => item.userId === actor.userId)) return project;
  if (project.invitePolicy === "approve" && invite.status === "active") {
    const pending: ProjectInvite = { ...invite, status: "pending", requestedBy: actor.userId, requestedEmail: actor.email };
    const invites = project.invites.map((item) => (item.token === token ? pending : item));
    return save(pushEvent({ ...project, invites }, actor, "join_requested", `${actor.email} 申请加入`));
  }
  if (project.members.length >= MAX_MEMBERS) throw new Error(`一个项目最多 ${MAX_MEMBERS} 人`);
  const member: ProjectMember = { userId: actor.userId, email: actor.email, role: "member", joinedAt: new Date().toISOString() };
  const invites = project.invites.map((item) => (item.token === token ? { ...item, status: "accepted" as const } : item));
  return save(pushEvent({ ...project, members: [...project.members, member], invites }, actor, "joined", `${actor.email} 加入了项目`));
}

export function approveInvite(projectId: string, token: string, actor: { userId: string; email: string }): Project {
  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");
  if (!canManageProject(memberRole(projectId, actor.userId))) throw new Error("没有权限审批");
  const invite = project.invites.find((item) => item.token === token);
  if (!invite?.requestedBy || !invite.requestedEmail) throw new Error("没有待审批的申请");
  if (project.members.some((item) => item.userId === invite.requestedBy)) {
    const invites = project.invites.map((item) => (item.token === token ? { ...item, status: "accepted" as const } : item));
    return save({ ...project, invites, updatedAt: new Date().toISOString() });
  }
  if (project.members.length >= MAX_MEMBERS) throw new Error(`一个项目最多 ${MAX_MEMBERS} 人`);
  const member: ProjectMember = {
    userId: invite.requestedBy,
    email: invite.requestedEmail,
    role: "member",
    joinedAt: new Date().toISOString(),
  };
  const invites = project.invites.map((item) => (item.token === token ? { ...item, status: "accepted" as const } : item));
  return save(pushEvent({ ...project, members: [...project.members, member], invites }, actor, "approved", `通过了 ${invite.requestedEmail}`));
}

export function addProjectMember(
  projectId: string,
  member: { userId: string; email: string; role?: ProjectRole },
  actor: { userId: string; email: string },
): Project {
  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");
  if (!canManageProject(memberRole(projectId, actor.userId))) throw new Error("没有权限加成员");
  if (project.members.some((item) => item.userId === member.userId)) return project;
  if (project.members.length >= MAX_MEMBERS) throw new Error(`一个项目最多 ${MAX_MEMBERS} 人`);
  const next: ProjectMember = {
    userId: member.userId,
    email: member.email,
    role: member.role === "admin" ? "admin" : "member",
    joinedAt: new Date().toISOString(),
  };
  return save(pushEvent({ ...project, members: [...project.members, next] }, actor, "member_added", `加入了 ${member.email}`));
}

export function recordProjectEvent(projectId: string, actor: { userId: string; email: string }, kind: string, detail: string): void {
  const project = getProject(projectId);
  if (!project) return;
  save(pushEvent(project, actor, kind, detail));
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  BUNDLED_EXPERTS,
  MAX_EXPERT_BODY,
  MAX_USER_EXPERTS,
  bundledExpertById,
  canEditExpert,
  canManageProject,
  canUseExpert,
  expertBodyLength,
  slugifyExpertName,
  sortExpertsForPicker,
  type CreateExpertRequest,
  type Expert,
  type ExpertVisibility,
  type UpdateExpertRequest,
} from "@neo-cloud-agent/contracts";
import { controlStateDir } from "../store/persist.js";
import { getProject, memberRole } from "../projects/store.js";
import { expertPersistHooks } from "./persist-hooks.js";

export function expertsFile(): string {
  return path.join(controlStateDir(), "experts.json");
}

let expertMemo: { file: string; items: Expert[] } | null = null;

function readAll(): Expert[] {
  const file = expertsFile();
  if (expertMemo?.file === file) {
    return expertMemo.items;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { experts?: unknown };
    const items = Array.isArray(parsed.experts) ? parsed.experts.map(normalize).filter(Boolean) as Expert[] : [];
    expertMemo = { file, items };
    return items;
  } catch {
    expertMemo = { file, items: [] };
    return expertMemo.items;
  }
}

function writeAll(items: Expert[], options?: { mirror?: boolean }): void {
  const file = expertsFile();
  expertMemo = { file, items };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 1, experts: items }, null, 2)}\n`, { mode: 0o600 });
  if (options?.mirror !== false) {
    expertPersistHooks().onWrite?.(items);
  }
}

export function replaceExperts(items: Expert[], options?: { mirror?: boolean }): void {
  writeAll(items.map((item) => normalize(item)).filter((item): item is Expert => Boolean(item)), options);
}

function asVisibility(value: unknown): ExpertVisibility {
  return value === "project" ? "project" : "user";
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function normalize(value: unknown): Expert | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record || typeof record.id !== "string" || typeof record.name !== "string") {
    return null;
  }
  const visibility = asVisibility(record.visibility);
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
  const name = record.name.trim();
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const persona = typeof record.persona === "string" ? record.persona : "";
  const methodology = typeof record.methodology === "string" ? record.methodology : "";
  const deliverables = typeof record.deliverables === "string" ? record.deliverables : "";
  if (!name || !description || !persona.trim() || !methodology.trim() || !deliverables.trim()) {
    return null;
  }
  return {
    id: record.id,
    slug: typeof record.slug === "string" && record.slug.trim() ? record.slug.trim() : slugifyExpertName(name),
    name,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : undefined,
    description,
    industry: typeof record.industry === "string" && record.industry.trim() ? record.industry.trim() : undefined,
    persona,
    methodology,
    deliverables,
    tools: asStringList(record.tools),
    skillNames: asStringList(record.skillNames),
    model: typeof record.model === "string" && record.model.trim() ? record.model.trim() : undefined,
    examplePrompts: asStringList(record.examplePrompts),
    visibility,
    ownerUserId: typeof record.ownerUserId === "string" ? record.ownerUserId : undefined,
    projectId: typeof record.projectId === "string" ? record.projectId : undefined,
    createdAt,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : createdAt,
  };
}

function save(expert: Expert): Expert {
  const items = readAll();
  const index = items.findIndex((item) => item.id === expert.id);
  if (index < 0) items.push(expert);
  else items[index] = expert;
  writeAll(items);
  return expert;
}

export function listStoredExperts(): Expert[] {
  return [...readAll()];
}

export function getStoredExpert(id: string): Expert | null {
  return readAll().find((item) => item.id === id || item.slug === id) ?? null;
}

export function resolveExpert(id: string): Expert | null {
  return bundledExpertById(id) ?? getStoredExpert(id);
}

export function listExpertsForActor(input: {
  userId?: string;
  projectId?: string | null;
  query?: string;
}): Expert[] {
  const project = input.projectId ? getProject(input.projectId) : null;
  const projectMember = Boolean(input.userId && project && memberRole(project.id, input.userId));
  const stored = readAll().filter((item) =>
    canUseExpert(item, { userId: input.userId, projectId: project?.id ?? null, projectMember }),
  );
  const merged = [...BUNDLED_EXPERTS, ...stored];
  const q = (input.query ?? "").trim().toLowerCase();
  const filtered = q
    ? merged.filter((item) =>
        [item.name, item.title, item.description, item.slug, item.industry].some((value) =>
          (value ?? "").toLowerCase().includes(q),
        ),
      )
    : merged;
  return sortExpertsForPicker(filtered, project?.expertIds ?? []);
}

function assertBody(expert: Pick<Expert, "persona" | "methodology" | "deliverables">): void {
  if (expertBodyLength(expert) > MAX_EXPERT_BODY) {
    throw new Error(`专家正文最多 ${MAX_EXPERT_BODY} 字符`);
  }
}

export function createExpert(input: CreateExpertRequest, actor: { userId: string; email: string }): Expert {
  const name = input.name.trim();
  const description = input.description.trim();
  const persona = input.persona.trim();
  const methodology = input.methodology.trim();
  const deliverables = input.deliverables.trim();
  if (!name) throw new Error("专家名称不能为空");
  if (!description) throw new Error("专家简介不能为空");
  if (!persona || !methodology || !deliverables) throw new Error("人设、方法论和交付标准都要写");
  assertBody({ persona, methodology, deliverables });
  const visibility = input.visibility === "project" ? "project" : "user";
  if (visibility === "project") {
    const projectId = input.projectId?.trim() ?? "";
    if (!projectId || !getProject(projectId)) throw new Error("项目不存在");
    if (!canManageProject(memberRole(projectId, actor.userId))) throw new Error("没有权限在项目里建专家");
  }
  const owned = readAll().filter((item) => item.ownerUserId === actor.userId && item.visibility === "user");
  if (visibility === "user" && owned.length >= MAX_USER_EXPERTS) {
    throw new Error(`最多 ${MAX_USER_EXPERTS} 个个人专家`);
  }
  const now = new Date().toISOString();
  const expert: Expert = {
    id: `exp_${randomUUID().slice(0, 8)}`,
    slug: (input.slug?.trim() || slugifyExpertName(name)).slice(0, 40),
    name,
    title: input.title?.trim() || undefined,
    description,
    industry: input.industry?.trim() || undefined,
    persona,
    methodology,
    deliverables,
    tools: input.tools?.map((item) => item.trim()).filter(Boolean),
    skillNames: input.skillNames?.map((item) => item.trim()).filter(Boolean),
    model: input.model?.trim() || undefined,
    examplePrompts: input.examplePrompts?.map((item) => item.trim()).filter(Boolean),
    visibility,
    ownerUserId: actor.userId,
    projectId: visibility === "project" ? input.projectId : undefined,
    createdAt: now,
    updatedAt: now,
  };
  return save(expert);
}

export function updateExpert(id: string, patch: UpdateExpertRequest, actor: { userId: string }): Expert {
  const current = getStoredExpert(id);
  if (!current) throw new Error("专家不存在");
  const manageProject = Boolean(current.projectId && canManageProject(memberRole(current.projectId, actor.userId)));
  if (!canEditExpert(current, { userId: actor.userId, manageProject })) {
    throw new Error("没有权限改这个专家");
  }
  const next: Expert = {
    ...current,
    name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
    slug: patch.slug !== undefined ? patch.slug.trim() || current.slug : current.slug,
    title: patch.title !== undefined ? patch.title.trim() || undefined : current.title,
    description: patch.description !== undefined ? patch.description.trim() || current.description : current.description,
    industry: patch.industry !== undefined ? patch.industry.trim() || undefined : current.industry,
    persona: patch.persona !== undefined ? patch.persona : current.persona,
    methodology: patch.methodology !== undefined ? patch.methodology : current.methodology,
    deliverables: patch.deliverables !== undefined ? patch.deliverables : current.deliverables,
    tools: patch.tools === null ? undefined : patch.tools !== undefined ? patch.tools.map((item) => item.trim()).filter(Boolean) : current.tools,
    skillNames:
      patch.skillNames === null
        ? undefined
        : patch.skillNames !== undefined
          ? patch.skillNames.map((item) => item.trim()).filter(Boolean)
          : current.skillNames,
    model: patch.model === null ? undefined : patch.model !== undefined ? patch.model.trim() || undefined : current.model,
    examplePrompts:
      patch.examplePrompts === null
        ? undefined
        : patch.examplePrompts !== undefined
          ? patch.examplePrompts.map((item) => item.trim()).filter(Boolean)
          : current.examplePrompts,
    updatedAt: new Date().toISOString(),
  };
  assertBody(next);
  return save(next);
}

export function deleteExpert(id: string, actor: { userId: string }): void {
  const current = getStoredExpert(id);
  if (!current) throw new Error("专家不存在");
  const manageProject = Boolean(current.projectId && canManageProject(memberRole(current.projectId, actor.userId)));
  if (!canEditExpert(current, { userId: actor.userId, manageProject })) {
    throw new Error("没有权限删这个专家");
  }
  writeAll(readAll().filter((item) => item.id !== current.id));
}

export function requireUsableExpert(
  id: string,
  actor: { userId?: string; projectId?: string | null },
): Expert {
  const expert = resolveExpert(id);
  if (!expert) throw new Error("专家不存在");
  const project = actor.projectId ? getProject(actor.projectId) : expert.projectId ? getProject(expert.projectId) : null;
  const projectMember = Boolean(actor.userId && project && memberRole(project.id, actor.userId));
  if (!canUseExpert(expert, { userId: actor.userId, projectId: project?.id ?? actor.projectId, projectMember })) {
    throw new Error("不能使用这个专家");
  }
  return expert;
}

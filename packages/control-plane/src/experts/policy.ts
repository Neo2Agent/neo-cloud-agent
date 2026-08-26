import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BUNDLED_EXPERTS,
  MAX_EXPERT_BODY,
  applyBundledExpertOverride,
  bundledExpertById,
  canAccessBundledExpertPolicy,
  defaultBundledExpertPolicyEntry,
  emptyBundledExpertPolicyDocument,
  expertBodyLength,
  renderExpertRole,
  type BundledExpertAudience,
  type BundledExpertOverrideFields,
  type BundledExpertPolicyDocument,
  type BundledExpertPolicyEntry,
  type ConfigureBundledExpertRequest,
  type Expert,
  type PublishBundledExpertRequest,
} from "@neo-cloud-agent/contracts";
import { listPublicUsers } from "../accounts/accounts.js";
import { controlStateDir } from "../store/persist.js";
import { bundledExpertPolicyPersistHooks } from "./policy-persist.js";

export type AdminBundledExpertRow = {
  id: string;
  slug: string;
  baseline: Expert;
  live: Expert;
  enabled: boolean;
  audience: BundledExpertAudience;
  userIds: string[];
  users: Array<{ id: string; email: string }>;
  override: BundledExpertOverrideFields;
  updatedAt: string;
  publishedAt: string | null;
  markdown: string;
};

let memo: { file: string; mtime: number; doc: BundledExpertPolicyDocument } | null = null;

export function bundledExpertPolicyFile(): string {
  return path.join(controlStateDir(), "bundled-expert-policy.json");
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : [];
}

function asOverride(value: unknown): BundledExpertOverrideFields {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const override: BundledExpertOverrideFields = {};
  if (typeof record.name === "string") override.name = record.name;
  if (record.title === null) override.title = null;
  else if (typeof record.title === "string") override.title = record.title;
  if (typeof record.description === "string") override.description = record.description;
  if (record.industry === null) override.industry = null;
  else if (typeof record.industry === "string") override.industry = record.industry;
  if (typeof record.persona === "string") override.persona = record.persona;
  if (typeof record.methodology === "string") override.methodology = record.methodology;
  if (typeof record.deliverables === "string") override.deliverables = record.deliverables;
  if (record.tools === null) override.tools = null;
  else if (Array.isArray(record.tools)) override.tools = asStringList(record.tools);
  if (record.skillNames === null) override.skillNames = null;
  else if (Array.isArray(record.skillNames)) override.skillNames = asStringList(record.skillNames);
  if (record.model === null) override.model = null;
  else if (typeof record.model === "string") override.model = record.model;
  if (record.examplePrompts === null) override.examplePrompts = null;
  else if (Array.isArray(record.examplePrompts)) override.examplePrompts = asStringList(record.examplePrompts);
  return override;
}

function asEntry(value: unknown): BundledExpertPolicyEntry | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record) return null;
  const fallback = defaultBundledExpertPolicyEntry();
  const audience = record.audience === "allowlist" ? "allowlist" : "all";
  const userIds = Array.isArray(record.userIds)
    ? [...new Set(record.userIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0))]
    : [];
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : fallback.updatedAt;
  return {
    enabled: record.enabled !== false,
    audience,
    userIds,
    override: asOverride(record.override),
    updatedAt,
    publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : null,
  };
}

function normalizeDocument(value: unknown): BundledExpertPolicyDocument {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const expertsIn = record?.experts && typeof record.experts === "object" ? (record.experts as Record<string, unknown>) : {};
  const experts: Record<string, BundledExpertPolicyEntry> = {};
  for (const [id, raw] of Object.entries(expertsIn)) {
    const entry = asEntry(raw);
    if (entry) experts[id] = entry;
  }
  return {
    version: 1,
    updatedAt: typeof record?.updatedAt === "string" ? record.updatedAt : emptyBundledExpertPolicyDocument().updatedAt,
    experts,
  };
}

export function readBundledExpertPolicy(): BundledExpertPolicyDocument {
  const file = bundledExpertPolicyFile();
  try {
    const mtime = statSync(file).mtimeMs;
    if (memo?.file === file && memo.mtime === mtime) {
      return memo.doc;
    }
    const doc = normalizeDocument(JSON.parse(readFileSync(file, "utf8")));
    memo = { file, mtime, doc };
    return doc;
  } catch {
    const doc = emptyBundledExpertPolicyDocument();
    memo = { file, mtime: 0, doc };
    return doc;
  }
}

export function replaceBundledExpertPolicy(doc: BundledExpertPolicyDocument, options?: { mirror?: boolean }): void {
  const file = bundledExpertPolicyFile();
  const next = normalizeDocument(doc);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  memo = { file, mtime: statSync(file).mtimeMs, doc: next };
  if (options?.mirror !== false) {
    bundledExpertPolicyPersistHooks().onWrite?.(next);
  }
}

function writePolicy(mutate: (doc: BundledExpertPolicyDocument) => void): BundledExpertPolicyDocument {
  const doc = structuredClone(readBundledExpertPolicy());
  mutate(doc);
  doc.updatedAt = new Date().toISOString();
  replaceBundledExpertPolicy(doc);
  return doc;
}

export function resetBundledExpertPolicyForTests(): void {
  replaceBundledExpertPolicy(emptyBundledExpertPolicyDocument(new Date().toISOString()));
}

export function getBundledExpertPolicyEntry(id: string): BundledExpertPolicyEntry {
  const expert = bundledExpertById(id);
  if (!expert) return defaultBundledExpertPolicyEntry();
  return readBundledExpertPolicy().experts[expert.id] ?? defaultBundledExpertPolicyEntry();
}

export function mergeBundledExpert(id: string): Expert | null {
  const base = bundledExpertById(id);
  if (!base) return null;
  const entry = getBundledExpertPolicyEntry(base.id);
  return { ...applyBundledExpertOverride(base, entry.override), updatedAt: entry.updatedAt || base.updatedAt };
}

export function listMergedBundledExperts(): Expert[] {
  return BUNDLED_EXPERTS.map((item) => mergeBundledExpert(item.id)!);
}

export function canAccessBundledExpert(id: string, userId?: string): boolean {
  const expert = bundledExpertById(id);
  if (!expert) return false;
  return canAccessBundledExpertPolicy(getBundledExpertPolicyEntry(expert.id), userId);
}

function requireBundled(id: string): Expert {
  const expert = bundledExpertById(id);
  if (!expert) throw new Error("内置专家不存在");
  return expert;
}

function applyConfigurePatch(current: BundledExpertOverrideFields, patch: ConfigureBundledExpertRequest): BundledExpertOverrideFields {
  const next = { ...current };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.industry !== undefined) next.industry = patch.industry;
  if (patch.persona !== undefined) next.persona = patch.persona;
  if (patch.methodology !== undefined) next.methodology = patch.methodology;
  if (patch.deliverables !== undefined) next.deliverables = patch.deliverables;
  if (patch.tools !== undefined) next.tools = patch.tools;
  if (patch.skillNames !== undefined) next.skillNames = patch.skillNames;
  if (patch.model !== undefined) next.model = patch.model;
  if (patch.examplePrompts !== undefined) next.examplePrompts = patch.examplePrompts;
  return next;
}

export function configureBundledExpert(id: string, patch: ConfigureBundledExpertRequest): BundledExpertPolicyEntry {
  const base = requireBundled(id);
  const now = new Date().toISOString();
  writePolicy((doc) => {
    const current = doc.experts[base.id] ?? defaultBundledExpertPolicyEntry();
    const override = applyConfigurePatch(current.override, patch);
    const live = applyBundledExpertOverride(base, override);
    if (expertBodyLength(live) > MAX_EXPERT_BODY) {
      throw new Error(`专家正文最多 ${MAX_EXPERT_BODY} 字符`);
    }
    doc.experts[base.id] = {
      ...current,
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
      override,
      updatedAt: now,
    };
  });
  return getBundledExpertPolicyEntry(base.id);
}

export function publishBundledExpert(id: string, input: PublishBundledExpertRequest): BundledExpertPolicyEntry {
  const base = requireBundled(id);
  if (input.audience !== "all" && input.audience !== "allowlist") {
    throw new Error("下发范围只能是全部用户或指定用户");
  }
  const userIds = [...new Set((input.userIds ?? []).map((item) => item.trim()).filter(Boolean))];
  if (input.audience === "allowlist" && userIds.length === 0) {
    throw new Error("指定用户时至少选一个人");
  }
  const now = new Date().toISOString();
  writePolicy((doc) => {
    const current = doc.experts[base.id] ?? defaultBundledExpertPolicyEntry();
    doc.experts[base.id] = {
      ...current,
      audience: input.audience,
      userIds: input.audience === "all" ? [] : userIds,
      updatedAt: now,
      publishedAt: now,
    };
  });
  return getBundledExpertPolicyEntry(base.id);
}

export function resetBundledExpert(id: string, input?: { grants?: boolean }): BundledExpertPolicyEntry {
  const base = requireBundled(id);
  const now = new Date().toISOString();
  writePolicy((doc) => {
    if (input?.grants) {
      delete doc.experts[base.id];
      return;
    }
    const current = doc.experts[base.id];
    if (!current) return;
    doc.experts[base.id] = {
      ...current,
      override: {},
      updatedAt: now,
    };
  });
  return getBundledExpertPolicyEntry(base.id);
}

export async function adminBundledExpertsPayload(): Promise<{
  experts: AdminBundledExpertRow[];
  users: Array<{ id: string; email: string }>;
}> {
  const users = (await listPublicUsers()).map((item) => ({ id: item.id, email: item.email }));
  const byId = new Map(users.map((item) => [item.id, item]));
  const experts = BUNDLED_EXPERTS.map((base) => {
    const entry = getBundledExpertPolicyEntry(base.id);
    const live = applyBundledExpertOverride(base, entry.override);
    return {
      id: base.id,
      slug: base.slug,
      baseline: base,
      live: { ...live, updatedAt: entry.updatedAt || base.updatedAt },
      enabled: entry.enabled,
      audience: entry.audience,
      userIds: entry.userIds,
      users: entry.userIds.map((id) => byId.get(id) ?? { id, email: id }),
      override: entry.override,
      updatedAt: entry.updatedAt,
      publishedAt: entry.publishedAt,
      markdown: renderExpertRole({ ...live, updatedAt: entry.updatedAt || base.updatedAt }),
    };
  });
  return { experts, users };
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WORKSPACE_SKILL_DIRS = [
  ".pi/skills",
  ".cursor/skills",
  ".claude/skills",
  ".codex/skills",
  ".neo/skills",
  ".agents/skills",
] as const;

export const MAX_PLUGIN_BYTES = 5 * 1024 * 1024;
export const MAX_PLUGIN_FILES = 200;
export const MAX_ENABLED_PLUGINS = 12;
export const MAX_SKILL_NAME = 64;
export const MAX_SKILL_DESCRIPTION = 1024;

export type PluginKind = "skill" | "mcp" | "bundle";
export type PluginVisibility = "bundled" | "user" | "project";
export type PluginSourceType = "bundled" | "git" | "url" | "upload" | "local";
export type PluginInstallScope = "user" | "project";

export type PluginSource = {
  type: PluginSourceType;
  marketplaceId?: string;
  gitUrl?: string;
  ref?: string;
  path?: string;
  digest: string;
};

export type Plugin = {
  id: string;
  slug: string;
  name: string;
  version: string;
  description: string;
  kind: PluginKind;
  category?: string;
  keywords?: string[];
  homepage?: string;
  license?: string;
  interface?: {
    displayName?: string;
    shortDescription?: string;
    defaultPrompt?: string[];
  };
  skills: string[];
  mcpServerNames?: string[];
  visibility: PluginVisibility;
  source: PluginSource;
  ownerUserId?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
};

export type PluginInstall = {
  id: string;
  pluginId: string;
  version: string;
  digest: string;
  scope: PluginInstallScope;
  ownerUserId?: string;
  projectId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PluginCatalogItem = Plugin & {
  installed: boolean;
  enabled: boolean;
  installScope?: PluginInstallScope;
  pinned: boolean;
  preview?: string;
};

export type PluginWorkspaceEntry = {
  slug: string;
  version: string;
  digest: string;
};

export type PluginWorkspaceSnapshot = {
  plugins: PluginWorkspaceEntry[];
  warnings: string[];
};

export type SkillPackage = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
  body: string;
  raw: string;
};

export type BundledSkill = {
  name: string;
  description: string;
  raw: string;
};

export type BundledPlugin = Plugin & {
  skillContents: BundledSkill[];
};

export type MarketplaceFile = {
  name: string;
  displayName?: string;
  owner?: { name?: string; email?: string };
  plugins: MarketplacePluginEntry[];
};

export type MarketplacePluginEntry = {
  name: string;
  description?: string;
  version?: string;
  category?: string;
  source?: unknown;
  skipped?: string;
};

export type NormalizedPluginManifest = {
  name: string;
  version: string;
  description: string;
  skills: string;
  extra: Record<string, unknown>;
};

const BUNDLED_AT = "2026-08-28T00:00:00.000Z";
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function skillsRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../skills");
}

export function isSafeRelativePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("./")) return false;
  if (trimmed.includes("\0")) return false;
  const parts = trimmed.slice(2).split(/[\\/]/);
  return parts.every((part) => part.length > 0 && part !== "." && part !== ".." && !part.includes(":"));
}

export function assertSafeRelativePath(value: string): string {
  if (!isSafeRelativePath(value)) {
    throw new Error(`路径必须是包内相对路径且以 ./ 开头：${value}`);
  }
  return value.trim();
}

export function isValidSkillName(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SKILL_NAME && SKILL_NAME_RE.test(value);
}

export function parseSkillMd(content: string): SkillPackage | { error: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
  if (!match) {
    return { error: "SKILL.md 需要 YAML frontmatter" };
  }
  const fields = parseSimpleYaml(match[1] ?? "");
  const name = (fields.name ?? "").trim();
  const description = (fields.description ?? "").trim();
  if (!isValidSkillName(name)) {
    return { error: "Skill name 必须是 kebab-case，最长 64" };
  }
  if (!description || description.length > MAX_SKILL_DESCRIPTION) {
    return { error: "Skill description 必填，最长 1024" };
  }
  const allowed = fields["allowed-tools"]?.trim();
  return {
    name,
    description,
    license: fields.license?.trim() || undefined,
    compatibility: fields.compatibility?.trim() || undefined,
    allowedTools: allowed ? allowed.split(/[\s,]+/).filter(Boolean) : undefined,
    body: (match[2] ?? "").trim(),
    raw: content.endsWith("\n") ? content : `${content}\n`,
  };
}

function parseSimpleYaml(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const cut = line.indexOf(":");
    if (cut <= 0) continue;
    const key = line.slice(0, cut).trim();
    const value = line.slice(cut + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) fields[key] = value;
  }
  return fields;
}

export function parsePluginManifest(raw: unknown): NormalizedPluginManifest | { error: string } {
  const record = asRecord(raw);
  if (!record) return { error: "plugin.json 必须是对象" };
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!isValidSkillName(name)) return { error: "plugin name 必须是 kebab-case" };
  const version = typeof record.version === "string" && record.version.trim() ? record.version.trim() : "0.0.0";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (!description) return { error: "plugin description 不能为空" };
  const skills = normalizeSkillsField(record.skills);
  if ("error" in skills) return skills;
  const extra: Record<string, unknown> = { ...record };
  delete extra.name;
  delete extra.version;
  delete extra.description;
  delete extra.skills;
  return { name, version, description, skills: skills.path, extra };
}

function normalizeSkillsField(value: unknown): { path: string } | { error: string } {
  if (typeof value === "string") {
    try {
      return { path: assertSafeRelativePath(value) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "skills 路径非法" };
    }
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    for (const item of value) {
      if (!isSafeRelativePath(item)) {
        return { error: `skills 路径非法：${item}` };
      }
    }
    return { path: "./skills/" };
  }
  if (value == null) {
    return { path: "./skills/" };
  }
  return { error: "skills 必须是 ./ 开头的路径" };
}

export function parseMarketplaceFile(raw: unknown): MarketplaceFile | { error: string } {
  const record = asRecord(raw);
  if (!record) return { error: "marketplace.json 必须是对象" };
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name || !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(name)) {
    return { error: "marketplace name 必须是 kebab-case" };
  }
  const iface = asRecord(record.interface);
  const owner = asRecord(record.owner);
  const plugins = Array.isArray(record.plugins) ? record.plugins : [];
  const entries: MarketplacePluginEntry[] = [];
  for (const item of plugins) {
    const parsed = parseMarketplaceEntry(item);
    if (parsed) entries.push(parsed);
  }
  return {
    name: name || "marketplace",
    displayName:
      (typeof iface?.displayName === "string" && iface.displayName.trim()) ||
      (typeof record.description === "string" && record.description.trim()) ||
      undefined,
    owner: owner
      ? {
          name: typeof owner.name === "string" ? owner.name : undefined,
          email: typeof owner.email === "string" ? owner.email : undefined,
        }
      : undefined,
    plugins: entries,
  };
}

function parseMarketplaceEntry(value: unknown): MarketplacePluginEntry | null {
  const record = asRecord(value);
  if (!record || typeof record.name !== "string" || !record.name.trim()) {
    return null;
  }
  const source = record.source;
  let skipped: string | undefined;
  if (isRecord(source) && source.source === "npm") {
    skipped = "第一期不支持 npm 源";
  } else if (typeof source === "string" && !isSafeRelativePath(source)) {
    skipped = "相对路径必须是 ./ 开头且不能逃出市场根";
  } else if (isRecord(source) && typeof source.path === "string" && !isSafeRelativePath(source.path)) {
    skipped = "source.path 必须是 ./ 开头且不能逃出市场根";
  }
  return {
    name: record.name.trim(),
    description: typeof record.description === "string" ? record.description : undefined,
    version: typeof record.version === "string" ? record.version : undefined,
    category: typeof record.category === "string" ? record.category : undefined,
    source,
    skipped,
  };
}

export function pluginDigest(parts: Array<{ name: string; raw: string }>): string {
  const hash = createHash("sha256");
  for (const part of [...parts].sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update(part.name);
    hash.update("\n");
    hash.update(part.raw);
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function publicPlugin(plugin: BundledPlugin | Plugin): Plugin {
  const { skillContents: _omit, ...rest } = plugin as BundledPlugin;
  return rest;
}

export function pluginPickerLabel(plugin: Pick<Plugin, "name" | "interface">): string {
  return plugin.interface?.displayName?.trim() || plugin.name;
}

export function sortPluginsForCatalog(items: PluginCatalogItem[], pinnedIds: string[] = []): PluginCatalogItem[] {
  const rank = new Map(pinnedIds.map((id, index) => [id, index]));
  return [...items].sort((left, right) => {
    const leftPin = rank.has(left.id) || rank.has(left.slug) ? (rank.get(left.id) ?? rank.get(left.slug) ?? 0) : 999;
    const rightPin = rank.has(right.id) || rank.has(right.slug) ? (rank.get(right.id) ?? rank.get(right.slug) ?? 0) : 999;
    if (leftPin !== rightPin) return leftPin - rightPin;
    if (left.installed !== right.installed) return left.installed ? -1 : 1;
    return pluginPickerLabel(left).localeCompare(pluginPickerLabel(right), "zh");
  });
}

function loadBundledSkill(name: string): BundledSkill {
  const file = path.join(skillsRoot(), name, "SKILL.md");
  const raw = readFileSync(file, "utf8");
  const parsed = parseSkillMd(raw);
  if ("error" in parsed) {
    throw new Error(`${name}: ${parsed.error}`);
  }
  return { name: parsed.name, description: parsed.description, raw: parsed.raw };
}

function bundledPlugin(input: {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  prompts: string[];
  skill: string;
}): BundledPlugin {
  const skill = loadBundledSkill(input.skill);
  const digest = pluginDigest([skill]);
  return {
    id: input.id,
    slug: input.slug,
    name: input.name,
    version: "1.0.0",
    description: input.description,
    kind: "skill",
    category: input.category,
    keywords: [input.slug],
    interface: {
      displayName: input.name,
      shortDescription: input.description,
      defaultPrompt: input.prompts,
    },
    skills: [skill.name],
    visibility: "bundled",
    source: { type: "bundled", digest },
    createdAt: BUNDLED_AT,
    updatedAt: BUNDLED_AT,
    skillContents: [skill],
  };
}

export const BUNDLED_PLUGINS: BundledPlugin[] = [
  bundledPlugin({
    id: "plug_pr_review",
    slug: "pr-review",
    name: "PR 审查",
    description: "按严重级读 diff，只出意见，不改业务代码。",
    category: "engineering",
    prompts: ["审查这次改动，按 Blockers / Risks / Notes 列出。"],
    skill: "pr-review",
  }),
  bundledPlugin({
    id: "plug_release_notes",
    slug: "release-notes",
    name: "发布说明",
    description: "从提交和 PR 写用户能看的发版说明。",
    category: "docs",
    prompts: ["根据最近提交写一版发布说明。"],
    skill: "release-notes",
  }),
  bundledPlugin({
    id: "plug_repo_scout",
    slug: "repo-scout",
    name: "仓库侦察",
    description: "先摸清目录和入口，再下结论，不改文件。",
    category: "research",
    prompts: ["先摸清这个仓库的布局和怎么跑。"],
    skill: "repo-scout",
  }),
  bundledPlugin({
    id: "plug_incident_brief",
    slug: "incident-brief",
    name: "事故简报",
    description: "根据日志和近期提交写一页事故简报，不编造根因。",
    category: "engineering",
    prompts: ["根据现有日志写一页事故简报。"],
    skill: "incident-brief",
  }),
];

export function bundledPluginById(id: string): BundledPlugin | null {
  const key = id.trim();
  return (
    BUNDLED_PLUGINS.find((item) => item.id === key || item.slug === key || item.skills.includes(key)) ?? null
  );
}

export function listBundledPlugins(): Plugin[] {
  return BUNDLED_PLUGINS.map((item) => publicPlugin(item));
}

export function overlayCatalogItem(
  plugin: Plugin,
  install?: PluginInstall | null,
  pinnedIds: string[] = [],
): PluginCatalogItem {
  const pinned = pinnedIds.includes(plugin.id) || pinnedIds.includes(plugin.slug);
  return {
    ...plugin,
    installed: Boolean(install) || pinned,
    enabled: Boolean(install?.enabled) || pinned,
    installScope: install?.scope,
    pinned,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(asRecord(value));
}

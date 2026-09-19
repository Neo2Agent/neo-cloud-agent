import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_SKILL_RAW } from "./bundled-skill-raw.js";
import { parseSkillMd, publicPlugin, type BundledPlugin, type BundledSkill, type Plugin } from "./plugin.js";

const BUNDLED_AT = "2026-08-28T00:00:00.000Z";

/** Directory of SKILL.md files when the repo is on disk. Undefined in a CJS pack. */
function skillsRoot(): string | undefined {
  const metaUrl: unknown = import.meta.url;
  if (typeof metaUrl !== "string" || metaUrl.length === 0) {
    return undefined;
  }
  try {
    return path.join(path.dirname(fileURLToPath(metaUrl)), "../skills");
  } catch {
    return undefined;
  }
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

function readBundledSkillRaw(name: string): string {
  const root = skillsRoot();
  if (root) {
    try {
      return readFileSync(path.join(root, name, "SKILL.md"), "utf8");
    } catch {
      // Packaged CJS has no skills/ next to the bundle.
    }
  }
  const embedded = BUNDLED_SKILL_RAW[name];
  if (!embedded) {
    throw new Error(`bundled skill missing: ${name}`);
  }
  return embedded;
}

function loadBundledSkill(name: string): BundledSkill {
  const raw = readBundledSkillRaw(name);
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

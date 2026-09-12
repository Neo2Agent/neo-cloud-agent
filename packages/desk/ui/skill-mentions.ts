import type { PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import { listedSkillKey, parseListedSkillKey, SKILL_ORIGIN_SYSTEM, type ListedSkill } from "../src/skill-list";
import type { ComposerMention } from "./pages";

const MENTION_KIND_PLUGIN = "plugin" as const;

function catalogMatch(skill: ListedSkill, plugins: PluginCatalogItem[]): PluginCatalogItem | undefined {
  return plugins.find(
    (item) => item.slug === skill.slug || item.id === skill.slug || item.skills.includes(skill.slug),
  );
}

/** Workspace first, then system (skipping overridden slugs), then official installs. */
export function skillComposerMentions(input: {
  workspace: ListedSkill[];
  system: ListedSkill[];
  plugins: PluginCatalogItem[];
}): ComposerMention[] {
  const seen = new Set<string>();
  const mentions: ComposerMention[] = [];
  const pushLocal = (skill: ListedSkill) => {
    if (seen.has(skill.slug)) {
      return;
    }
    seen.add(skill.slug);
    mentions.push({
      kind: MENTION_KIND_PLUGIN,
      id: listedSkillKey(skill),
      label: skill.name,
      insert: `@技能 ${skill.name}`,
    });
  };
  for (const skill of input.workspace) {
    pushLocal(skill);
  }
  for (const skill of input.system) {
    pushLocal(skill);
  }
  for (const item of input.plugins) {
    if (!item.installed || !item.enabled || seen.has(item.slug)) {
      continue;
    }
    seen.add(item.slug);
    mentions.push({
      kind: MENTION_KIND_PLUGIN,
      id: item.id,
      label: item.name,
      insert: `@技能 ${item.name}`,
    });
  }
  return mentions;
}

export function resolveSkillUse(
  skill: ListedSkill,
  plugins: PluginCatalogItem[],
): { plugin: PluginCatalogItem } | { local: ListedSkill } {
  if (skill.origin === SKILL_ORIGIN_SYSTEM) {
    const plugin = catalogMatch(skill, plugins);
    if (plugin) {
      return { plugin };
    }
  }
  return { local: skill };
}

export function resolveSkillMention(input: {
  mentionId: string;
  workspace: ListedSkill[];
  system: ListedSkill[];
  plugins: PluginCatalogItem[];
}): { plugin: PluginCatalogItem } | { local: ListedSkill } | null {
  const parsed = parseListedSkillKey(input.mentionId);
  if (parsed) {
    const pool = parsed.origin === SKILL_ORIGIN_SYSTEM ? input.system : input.workspace;
    const skill = pool.find((item) => item.slug === parsed.slug);
    return skill ? resolveSkillUse(skill, input.plugins) : null;
  }
  const plugin = input.plugins.find((item) => item.id === input.mentionId || item.slug === input.mentionId);
  return plugin ? { plugin } : null;
}

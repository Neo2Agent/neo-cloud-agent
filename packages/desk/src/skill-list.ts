export const SKILL_ORIGIN_SYSTEM = "system" as const;
export const SKILL_ORIGIN_WORKSPACE = "workspace" as const;

export type ListedSkillOrigin = typeof SKILL_ORIGIN_SYSTEM | typeof SKILL_ORIGIN_WORKSPACE;

export type ListedSkill = {
  origin: ListedSkillOrigin;
  slug: string;
  name: string;
  description: string;
  relativePath: string;
  overridesSystem?: boolean;
};

export type SkillScanSkip = {
  origin: ListedSkillOrigin;
  relativePath: string;
  reason: string;
};

export type ListedSkills = {
  system: ListedSkill[];
  workspace: ListedSkill[];
  skipped: SkillScanSkip[];
};

export type ListSkillsRequest = {
  folder?: string;
};

export type ListSkillsResult = ListedSkills & {
  error?: string;
};

export function listedSkillKey(skill: Pick<ListedSkill, "origin" | "slug">): string {
  return `${skill.origin}:${skill.slug}`;
}

export function parseListedSkillKey(key: string): { origin: ListedSkillOrigin; slug: string } | null {
  const cut = key.indexOf(":");
  if (cut <= 0) {
    return null;
  }
  const origin = key.slice(0, cut);
  const slug = key.slice(cut + 1).trim();
  if ((origin !== SKILL_ORIGIN_SYSTEM && origin !== SKILL_ORIGIN_WORKSPACE) || !slug) {
    return null;
  }
  return { origin, slug };
}

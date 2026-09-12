import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseSkillMd, WORKSPACE_SKILL_DIRS } from "@neo-cloud-agent/contracts/plugin";
import { resolveInsideRoot } from "./local-fs.js";
import {
  SKILL_ORIGIN_SYSTEM,
  SKILL_ORIGIN_WORKSPACE,
  type ListedSkill,
  type ListedSkillOrigin,
  type ListedSkills,
  type SkillScanSkip,
} from "./skill-list.js";

export {
  listedSkillKey,
  parseListedSkillKey,
  SKILL_ORIGIN_SYSTEM,
  SKILL_ORIGIN_WORKSPACE,
} from "./skill-list.js";
export type { ListedSkill, ListedSkillOrigin, ListedSkills, ListSkillsRequest, ListSkillsResult, SkillScanSkip } from "./skill-list.js";

const SKILL_MD_FILENAME = "SKILL.md";
const HIDDEN_NAME_PREFIX = ".";
const WORKSPACE_RUNS_PREFIX = ".neo/runs";
export const UNAUTHORIZED_SKILL_FOLDER_ERROR = "文件夹未授权";

function toPosixRelative(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\\/g, "/");
}

function isUnderWorkspaceRuns(relativeDir: string): boolean {
  const normalized = relativeDir.replace(/\\/g, "/");
  return normalized === WORKSPACE_RUNS_PREFIX || normalized.startsWith(`${WORKSPACE_RUNS_PREFIX}/`);
}

function compareSlug(left: ListedSkill, right: ListedSkill): number {
  return left.slug.localeCompare(right.slug);
}

function readSkillEntry(input: {
  root: string;
  relativeDir: string;
  slug: string;
  origin: ListedSkillOrigin;
}): ListedSkill | SkillScanSkip {
  const relativePath = toPosixRelative(input.relativeDir, input.slug, SKILL_MD_FILENAME);
  try {
    const dest = resolveInsideRoot(input.root, path.join(input.relativeDir, input.slug, SKILL_MD_FILENAME));
    if (!existsSync(dest) || !statSync(dest).isFile()) {
      return { origin: input.origin, relativePath, reason: "missing SKILL.md" };
    }
    const parsed = parseSkillMd(readFileSync(dest, "utf8"));
    if ("error" in parsed) {
      return { origin: input.origin, relativePath, reason: parsed.error };
    }
    return {
      origin: input.origin,
      slug: input.slug,
      name: parsed.name,
      description: parsed.description,
      relativePath,
    };
  } catch (error) {
    return {
      origin: input.origin,
      relativePath,
      reason: error instanceof Error ? error.message : "unreadable",
    };
  }
}

function listSkillChildren(input: {
  root: string;
  relativeDir: string;
  origin: ListedSkillOrigin;
  seenSlugs?: Set<string>;
}): { skills: ListedSkill[]; skipped: SkillScanSkip[] } {
  const skills: ListedSkill[] = [];
  const skipped: SkillScanSkip[] = [];
  if (isUnderWorkspaceRuns(input.relativeDir)) {
    return { skills, skipped };
  }
  let parent: string;
  try {
    parent = resolveInsideRoot(input.root, input.relativeDir || ".");
  } catch (error) {
    skipped.push({
      origin: input.origin,
      relativePath: input.relativeDir || ".",
      reason: error instanceof Error ? error.message : "path rejected",
    });
    return { skills, skipped };
  }
  if (!existsSync(parent)) {
    return { skills, skipped };
  }
  let entries: string[];
  try {
    if (!statSync(parent).isDirectory()) {
      return { skills, skipped };
    }
    entries = readdirSync(parent);
  } catch (error) {
    skipped.push({
      origin: input.origin,
      relativePath: input.relativeDir || ".",
      reason: error instanceof Error ? error.message : "unreadable",
    });
    return { skills, skipped };
  }
  const seen = input.seenSlugs ?? new Set<string>();
  for (const name of entries) {
    if (!name || name.startsWith(HIDDEN_NAME_PREFIX)) {
      continue;
    }
    const child = path.join(parent, name);
    try {
      if (!statSync(child).isDirectory()) {
        continue;
      }
    } catch {
      // A child that vanished between readdir and stat is not a skill.
      continue;
    }
    if (seen.has(name)) {
      skipped.push({
        origin: input.origin,
        relativePath: toPosixRelative(input.relativeDir, name, SKILL_MD_FILENAME),
        reason: "duplicate slug",
      });
      continue;
    }
    const result = readSkillEntry({
      root: input.root,
      relativeDir: input.relativeDir,
      slug: name,
      origin: input.origin,
    });
    if ("reason" in result) {
      skipped.push(result);
      continue;
    }
    seen.add(name);
    skills.push(result);
  }
  return { skills, skipped };
}

function markWorkspaceOverrides(system: ListedSkill[], workspace: ListedSkill[]): ListedSkill[] {
  const systemKeys = new Set<string>();
  for (const item of system) {
    systemKeys.add(item.slug);
    systemKeys.add(item.name);
  }
  return workspace.map((item) =>
    systemKeys.has(item.slug) || systemKeys.has(item.name) ? { ...item, overridesSystem: true } : item,
  );
}

/** Product-root and in-repo skill folders. One SKILL.md per child directory. */
export function listLocalSkills(input: { systemDir: string; workspaceDir?: string }): ListedSkills {
  const systemScan = listSkillChildren({
    root: input.systemDir,
    relativeDir: "",
    origin: SKILL_ORIGIN_SYSTEM,
  });
  const skipped = [...systemScan.skipped];
  const workspaceSkills: ListedSkill[] = [];
  const workspaceDir = input.workspaceDir?.trim();
  if (workspaceDir) {
    const seenSlugs = new Set<string>();
    for (const relativeDir of WORKSPACE_SKILL_DIRS) {
      if (isUnderWorkspaceRuns(relativeDir)) {
        continue;
      }
      const scan = listSkillChildren({
        root: workspaceDir,
        relativeDir,
        origin: SKILL_ORIGIN_WORKSPACE,
        seenSlugs,
      });
      workspaceSkills.push(...scan.skills);
      skipped.push(...scan.skipped);
    }
  }
  return {
    system: systemScan.skills.sort(compareSlug),
    workspace: markWorkspaceOverrides(systemScan.skills, workspaceSkills).sort(compareSlug),
    skipped,
  };
}

/** Only the current target or an already-bound folder may be scanned as 「本仓库」. */
export function isAllowedSkillScanFolder(input: {
  folder?: string;
  boundFolders: string[];
  selectedFolder?: string;
}): boolean {
  const requested = input.folder?.trim();
  if (!requested) {
    return false;
  }
  const resolved = path.resolve(requested);
  const allowed = [...input.boundFolders, input.selectedFolder ?? ""]
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
  return allowed.some((item) => item === resolved);
}

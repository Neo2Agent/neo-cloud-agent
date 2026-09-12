import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeskPackaged } from "./ports.js";
import { deskRepoRoot } from "./spawn.js";
import { SKILLS_NEO_MANIFEST } from "./home.js";

export type SkillsNeoEntry = { name: string; digest: string };
export type SkillsNeoManifest = {
  version: 1;
  source: "bundled";
  syncedAt: string;
  skills: SkillsNeoEntry[];
};

/** Packaged app: `Resources/skills`. Dev: the contracts skill pack. */
export function bundledSkillsSourceDir(env: NodeJS.ProcessEnv = process.env): string {
  if (isDeskPackaged(env) && env.NEO_DESK_RESOURCES) {
    return path.join(env.NEO_DESK_RESOURCES, "skills");
  }
  return path.join(deskRepoRoot(), "packages/contracts/skills");
}

export function listBundledSkillDirs(sourceDir: string): string[] {
  if (!existsSync(sourceDir)) {
    return [];
  }
  return readdirSync(sourceDir)
    .filter((name) => !name.startsWith("."))
    .filter((name) => {
      const dir = path.join(sourceDir, name);
      return statSync(dir).isDirectory() && existsSync(path.join(dir, "SKILL.md"));
    })
    .sort();
}

export function skillDigest(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function readManifest(destDir: string): SkillsNeoManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(path.join(destDir, SKILLS_NEO_MANIFEST), "utf8")) as SkillsNeoManifest;
    if (parsed?.version !== 1 || !Array.isArray(parsed.skills)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Copy bundled system skills into `~/.neo/skills-neo`, same shape as
 * `~/.cursor/skills-cursor` (one folder per skill + `.sync-manifest.json`).
 */
export function syncSkillsNeo(input: {
  destDir: string;
  sourceDir: string;
  now?: string;
}): { destDir: string; skills: string[]; wrote: boolean } {
  const names = listBundledSkillDirs(input.sourceDir);
  const skills: SkillsNeoEntry[] = names.map((name) => {
    const raw = readFileSync(path.join(input.sourceDir, name, "SKILL.md"), "utf8");
    return { name, digest: skillDigest(raw.endsWith("\n") ? raw : `${raw}\n`) };
  });
  const current = readManifest(input.destDir);
  const same =
    current !== null &&
    current.skills.length === skills.length &&
    current.skills.every((item, index) => item.name === skills[index]?.name && item.digest === skills[index]?.digest);
  if (same) {
    return { destDir: input.destDir, skills: names, wrote: false };
  }

  mkdirSync(input.destDir, { recursive: true });
  for (const name of names) {
    const raw = readFileSync(path.join(input.sourceDir, name, "SKILL.md"), "utf8");
    const body = raw.endsWith("\n") ? raw : `${raw}\n`;
    const skillDir = path.join(input.destDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), body);
  }
  const manifest: SkillsNeoManifest = {
    version: 1,
    source: "bundled",
    syncedAt: input.now ?? new Date().toISOString(),
    skills,
  };
  writeFileSync(path.join(input.destDir, SKILLS_NEO_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return { destDir: input.destDir, skills: names, wrote: true };
}

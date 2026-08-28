import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MAX_ENABLED_PLUGINS,
  WORKSPACE_SKILL_DIRS,
  type BundledPlugin,
  type DeskAssignment,
  type PluginWorkspaceSnapshot,
} from "@neo-cloud-agent/contracts";

export type PluginSkillFile = { slug: string; files: Array<{ relativePath: string; content: string }> };

export type PluginFiles = {
  skills: PluginSkillFile[];
  snapshot: PluginWorkspaceSnapshot;
};

export function buildPluginFiles(input: {
  plugins: BundledPlugin[];
  workspaceDir?: string;
  wantedSkillNames?: string[];
}): PluginFiles {
  const warnings: string[] = [];
  const selected = input.plugins.slice(0, MAX_ENABLED_PLUGINS);
  if (input.plugins.length > MAX_ENABLED_PLUGINS) {
    warnings.push(`一次最多启用 ${MAX_ENABLED_PLUGINS} 个技能，其余已忽略`);
  }
  const skills: PluginSkillFile[] = [];
  for (const plugin of selected) {
    for (const skill of plugin.skillContents) {
      if (input.workspaceDir && workspaceHasSkill(input.workspaceDir, skill.name)) {
        warnings.push(`仓库已有技能 ${skill.name}，未覆盖`);
        continue;
      }
      skills.push({
        slug: skill.name,
        files: [{ relativePath: "SKILL.md", content: skill.raw.endsWith("\n") ? skill.raw : `${skill.raw}\n` }],
      });
    }
  }
  const materialized = new Set(skills.map((item) => item.slug));
  for (const name of input.wantedSkillNames ?? []) {
    const have = materialized.has(name) || Boolean(input.workspaceDir && workspaceHasSkill(input.workspaceDir, name));
    if (!have) {
      warnings.push(`专家需要技能 ${name}，但当前没有安装`);
    }
  }
  return {
    skills,
    snapshot: {
      plugins: selected.map((item) => ({ slug: item.slug, version: item.version, digest: item.source.digest })),
      warnings,
    },
  };
}

export function workspaceHasSkill(workspaceDir: string, name: string): boolean {
  return WORKSPACE_SKILL_DIRS.some((dir) => existsSync(path.join(workspaceDir, dir, name, "SKILL.md")));
}

export function writePluginFiles(workspaceDir: string, files: PluginFiles): void {
  const dest = path.join(workspaceDir, ".neo");
  mkdirSync(dest, { recursive: true });
  writeFileSync(path.join(dest, "plugins.json"), `${JSON.stringify(files.snapshot, null, 2)}\n`);
  for (const skill of files.skills) {
    const skillDir = path.join(dest, "skills", skill.slug);
    mkdirSync(skillDir, { recursive: true });
    for (const file of skill.files) {
      writeFileSync(path.join(skillDir, file.relativePath), file.content);
    }
  }
}

export function assignmentPluginFields(files: PluginFiles | null): Pick<DeskAssignment, "pluginSkills" | "pluginSnapshot"> {
  if (!files) return {};
  return {
    pluginSkills: files.skills,
    pluginSnapshot: `${JSON.stringify(files.snapshot, null, 2)}\n`,
  };
}

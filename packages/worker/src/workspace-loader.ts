import { existsSync } from "node:fs";
import path from "node:path";
import { DefaultResourceLoader, type ResourceLoader, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { createWorkspaceHookExtension, isInsideWorkspace } from "./hooks.js";

export const WORKSPACE_SKILL_DIRS = [
  ".pi/skills",
  ".cursor/skills",
  ".claude/skills",
  ".codex/skills",
  ".neo/skills",
  ".agents/skills",
] as const;

export function existingWorkspaceSkillPaths(cwd: string): string[] {
  const found: string[] = [];
  for (const relative of WORKSPACE_SKILL_DIRS) {
    const dir = path.resolve(cwd, relative);
    if (existsSync(dir) && isInsideWorkspace(cwd, dir)) {
      found.push(dir);
    }
  }
  return found;
}

export function projectContextFilesOnly(
  cwd: string,
  files: Array<{ path: string; content: string }>,
): Array<{ path: string; content: string }> {
  return files.filter((file) => isInsideWorkspace(cwd, file.path));
}

export async function createWorkspaceLoader(input: {
  cwd: string;
  agentDir: string;
  systemPrompt: string;
  settingsManager: SettingsManager;
}): Promise<ResourceLoader> {
  const cwd = path.resolve(input.cwd);
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: path.resolve(input.agentDir),
    settingsManager: input.settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: false,
    additionalSkillPaths: existingWorkspaceSkillPaths(cwd),
    systemPrompt: input.systemPrompt,
    extensionFactories: [createWorkspaceHookExtension(cwd)],
    agentsFilesOverride: (current) => ({
      agentsFiles: projectContextFilesOnly(cwd, current.agentsFiles),
    }),
  });
  await loader.reload();
  return loader;
}

export function summarizeWorkspaceResources(loader: ResourceLoader): { skills: string[]; agentsFiles: string[] } {
  return {
    skills: loader.getSkills().skills.map((skill) => skill.name),
    agentsFiles: loader.getAgentsFiles().agentsFiles.map((file) => file.path),
  };
}

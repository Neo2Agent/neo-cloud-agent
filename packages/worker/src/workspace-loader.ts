import { existsSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_SKILL_DIRS } from "@neo-cloud-agent/contracts";
import { DefaultResourceLoader, type ResourceLoader, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { createWorkspaceHookExtension, isInsideWorkspace } from "./hooks.js";
import { createWorkspaceSandboxExtension } from "./sandbox.js";

export { WORKSPACE_SKILL_DIRS };

export function existingWorkspaceSkillPaths(cwd: string, scratchDir?: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const candidates = [
    scratchDir?.trim() ? path.resolve(scratchDir, "skills") : "",
    ...WORKSPACE_SKILL_DIRS.map((relative) => path.resolve(cwd, relative)),
  ];
  for (const dir of candidates) {
    if (!dir || seen.has(dir) || !existsSync(dir) || !isInsideWorkspace(cwd, dir)) {
      continue;
    }
    seen.add(dir);
    found.push(dir);
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
  /** Desk runs only. A cloud VM is already an isolated box. */
  sandboxRoot?: string;
  /** Desk parallel runs: look in the run scratch before `<cwd>/.neo/skills`. */
  scratchDir?: string;
}): Promise<ResourceLoader> {
  const cwd = path.resolve(input.cwd);
  const extensionFactories = [createWorkspaceHookExtension(cwd)];
  if (input.sandboxRoot) {
    extensionFactories.push(createWorkspaceSandboxExtension(input.sandboxRoot));
  }
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: path.resolve(input.agentDir),
    settingsManager: input.settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: false,
    additionalSkillPaths: existingWorkspaceSkillPaths(cwd, input.scratchDir),
    systemPrompt: input.systemPrompt,
    extensionFactories,
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

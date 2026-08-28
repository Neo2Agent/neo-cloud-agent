import path from "node:path";

/** Shared contract directory. Cloud and This Computer use the same layout. */
export const NEO_DIR = ".neo";

/** Expert team markdown lives here, under a doc root or a run scratch dir. */
export const AGENTS_DIR = "agents";

/**
 * Workspace-root agent folders the cloud loader already understands.
 * Do not add a Desk-only fourth scheme.
 */
export const PROJECT_AGENT_RELATIVE_DIRS = [".pi/agents", ".cursor/agents", ".neo/agents"] as const;

function uniqueResolved(dirs: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of dirs) {
    const trimmed = dir?.trim();
    if (!trimmed) {
      continue;
    }
    const resolved = path.resolve(trimmed);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

/**
 * Roots that hold EXPERT.md / expert.json.
 *
 * First match wins: a local run's scratch, then `<cwd>/.neo`. Cloud never sets
 * scratch, so it only sees the workspace root.
 */
export function expertDocRoots(cwd: string, scratchDir?: string): string[] {
  return uniqueResolved([scratchDir, path.join(cwd, NEO_DIR)]);
}

/**
 * Directories that hold project / team agent markdown.
 *
 * Later entries win when two files share a name (`mergeSubagentDefinitions`
 * overwrites). Workspace project dirs come first; scratch is last so a local
 * run's team members beat a leftover file at the workspace root.
 */
export function expertAgentDirs(cwd: string, scratchDir?: string): string[] {
  const project = PROJECT_AGENT_RELATIVE_DIRS.map((relative) => path.join(cwd, relative));
  const scratchAgents = scratchDir?.trim() ? path.join(scratchDir, AGENTS_DIR) : undefined;
  return uniqueResolved([...project, scratchAgents]);
}

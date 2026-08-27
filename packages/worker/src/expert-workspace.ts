import { readFileSync } from "node:fs";
import path from "node:path";
import { parseExpertWorkspaceMeta } from "@neo-cloud-agent/contracts";

/**
 * Read the expert role for this run.
 *
 * `scratchDir` wins when set, because several local runs can share one folder
 * and each needs its own persona. Cloud runs own their workspace outright and
 * keep using `<cwd>/.neo`, which is also the fallback for runs that started
 * before the per-run layout existed.
 */
export function readExpertWorkspace(cwd: string, scratchDir?: string): { role: string; tools?: string[] } {
  const roots = [scratchDir, path.join(cwd, ".neo")].filter((dir): dir is string => Boolean(dir));
  let tools: string[] | undefined;
  for (const root of roots) {
    try {
      const meta = parseExpertWorkspaceMeta(readFileSync(path.join(root, "expert.json"), "utf8"));
      if (meta?.tools) {
        tools = meta.tools;
        break;
      }
    } catch {
      // try the next root
    }
  }
  for (const root of roots) {
    for (const name of ["EXPERT_TEAM.md", "EXPERT.md"] as const) {
      try {
        const role = readFileSync(path.join(root, name), "utf8").trim();
        if (role) {
          return { role, tools };
        }
      } catch {
        // try next
      }
    }
  }
  return { role: "", tools };
}

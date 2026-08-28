import { readFileSync } from "node:fs";
import path from "node:path";
import { parseExpertWorkspaceMeta } from "@neo-cloud-agent/contracts";
import { expertDocRoots } from "@neo-cloud-agent/extensions";

const EXPERT_DOC_NAMES = ["EXPERT_TEAM.md", "EXPERT.md"] as const;
const EXPERT_META_FILE = "expert.json";

/**
 * Read the expert role for this run.
 *
 * Roots come from `expertDocRoots`: a local run's scratch wins, then
 * `<cwd>/.neo`. Cloud never sets scratch, so it only sees the workspace root.
 */
export function readExpertWorkspace(cwd: string, scratchDir?: string): { role: string; tools?: string[] } {
  const roots = expertDocRoots(cwd, scratchDir);
  let tools: string[] | undefined;
  for (const root of roots) {
    try {
      const meta = parseExpertWorkspaceMeta(readFileSync(path.join(root, EXPERT_META_FILE), "utf8"));
      if (meta?.tools) {
        tools = meta.tools;
        break;
      }
    } catch {
      // Missing or invalid expert.json — try the next root.
    }
  }
  for (const root of roots) {
    for (const name of EXPERT_DOC_NAMES) {
      try {
        const role = readFileSync(path.join(root, name), "utf8").trim();
        if (role) {
          return { role, tools };
        }
      } catch {
        // Missing role file — try the next name or root.
      }
    }
  }
  return { role: "", tools };
}

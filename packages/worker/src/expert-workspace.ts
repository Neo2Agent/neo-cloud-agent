import { readFileSync } from "node:fs";
import path from "node:path";
import { parseExpertWorkspaceMeta } from "@neo-cloud-agent/contracts";

export function readExpertWorkspace(cwd: string): { role: string; tools?: string[] } {
  let tools: string[] | undefined;
  try {
    const meta = parseExpertWorkspaceMeta(readFileSync(path.join(cwd, ".neo", "expert.json"), "utf8"));
    tools = meta?.tools;
  } catch {
    tools = undefined;
  }
  for (const name of ["EXPERT_TEAM.md", "EXPERT.md"] as const) {
    try {
      const role = readFileSync(path.join(cwd, ".neo", name), "utf8").trim();
      if (role) {
        return { role, tools };
      }
    } catch {
      // try next
    }
  }
  return { role: "", tools };
}

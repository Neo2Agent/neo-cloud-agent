import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseEnvironmentJson, type McpServerSpec } from "@neo-cloud-agent/contracts";

const CANDIDATES = [".neo/environment.json", ".cursor/environment.json"] as const;

function readEnvFile(file: string): McpServerSpec[] {
  if (!existsSync(file) || !statSync(file).isFile()) {
    return [];
  }
  try {
    return parseEnvironmentJson(JSON.parse(readFileSync(file, "utf8"))).mcp ?? [];
  } catch {
    return [];
  }
}

export function listWorkspaceMcpServers(workspaceDir: string): McpServerSpec[] {
  const servers: McpServerSpec[] = [];
  const seen = new Set<string>();
  const add = (file: string) => {
    for (const server of readEnvFile(file)) {
      if (seen.has(server.name)) continue;
      seen.add(server.name);
      servers.push(server);
    }
  };
  for (const rel of CANDIDATES) {
    add(path.join(workspaceDir, rel));
  }
  if (servers.length === 0 && existsSync(workspaceDir)) {
    for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      for (const rel of CANDIDATES) {
        add(path.join(workspaceDir, entry.name, rel));
      }
    }
  }
  return servers;
}

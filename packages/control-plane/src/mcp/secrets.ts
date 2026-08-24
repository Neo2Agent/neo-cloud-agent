import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveLlmSettingsRoot } from "@neo-cloud-agent/contracts";

const FILE_NAME = path.join(".neo", "mcp-secrets.json");

export type McpOAuthConfig = {
  authorizeUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
};

export type McpServerSecret = {
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig;
};

export type McpSecretsFile = Record<string, McpServerSecret>;

export type PublicMcpServer = {
  name: string;
  headersSet: boolean;
  oauthConfigured: boolean;
  connected: boolean;
};

function secretsFile(root = resolveLlmSettingsRoot()): string {
  return path.join(root, FILE_NAME);
}

export function readMcpSecrets(): McpSecretsFile {
  try {
    const raw = JSON.parse(readFileSync(secretsFile(), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    return raw as McpSecretsFile;
  } catch {
    return {};
  }
}

export function writeMcpSecrets(next: McpSecretsFile): PublicMcpServer[] {
  const file = secretsFile();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return publicMcpServers();
}

export function upsertMcpSecret(name: string, patch: McpServerSecret): PublicMcpServer[] {
  const key = name.trim();
  if (!key) {
    throw new Error("MCP server name is required");
  }
  const all = readMcpSecrets();
  const current = all[key] ?? {};
  all[key] = {
    headers: { ...(current.headers ?? {}), ...(patch.headers ?? {}) },
    oauth: { ...(current.oauth ?? {}), ...(patch.oauth ?? {}) },
  };
  if (patch.headers && Object.keys(patch.headers).length === 0) {
    delete all[key].headers;
  }
  return writeMcpSecrets(all);
}

export function deleteMcpSecret(name: string): PublicMcpServer[] {
  const key = name.trim();
  const all = readMcpSecrets();
  if (key) {
    delete all[key];
  } else {
    for (const item of Object.keys(all)) {
      delete all[item];
    }
  }
  return writeMcpSecrets(all);
}

export function headersForMcpServer(name: string): Record<string, string> {
  const secret = readMcpSecrets()[name] ?? {};
  const headers = { ...(secret.headers ?? {}) };
  const token = secret.oauth?.accessToken?.trim();
  if (token && !headers.authorization && !headers.Authorization) {
    headers.authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  }
  return headers;
}

export function publicMcpServers(): PublicMcpServer[] {
  return Object.entries(readMcpSecrets()).map(([name, value]) => ({
    name,
    headersSet: Boolean(value.headers && Object.keys(value.headers).length > 0),
    oauthConfigured: Boolean(value.oauth?.authorizeUrl && value.oauth.tokenUrl && value.oauth.clientId),
    connected: Boolean(value.oauth?.accessToken || (value.headers && Object.keys(value.headers).length > 0)),
  }));
}

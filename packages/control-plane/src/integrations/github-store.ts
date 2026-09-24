import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { controlStateDir } from "../store/persist.js";

export type GithubConnection = {
  userId: string;
  login: string;
  accessToken: string;
  scopes: string;
  updatedAt: string;
};

export type GithubSqlStore = {
  getGithubConnection(userId: string): Promise<GithubConnection | null>;
  putGithubConnection(conn: GithubConnection): Promise<void>;
  deleteGithubConnection(userId: string): Promise<void>;
};

let sqlStore: GithubSqlStore | null = null;

export function attachGithubSqlStore(store: GithubSqlStore | null): void {
  sqlStore = store;
}

export function resetGithubSqlStore(): void {
  sqlStore = null;
}

function connectionsDir(): string {
  return path.join(controlStateDir(), "integrations", "github");
}

function connectionFile(userId: string): string {
  return path.join(connectionsDir(), `${userId}.json`);
}

function parseConnection(raw: unknown, userId: string): GithubConnection | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<GithubConnection>;
  const login = (value.login ?? "").trim();
  const accessToken = (value.accessToken ?? "").trim();
  if (!login || !accessToken) {
    return null;
  }
  return {
    userId,
    login,
    accessToken,
    scopes: (value.scopes ?? "").trim(),
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
}

async function fileGet(userId: string): Promise<GithubConnection | null> {
  try {
    return parseConnection(JSON.parse(readFileSync(connectionFile(userId), "utf8")), userId);
  } catch {
    return null;
  }
}

async function filePut(conn: GithubConnection): Promise<void> {
  const dir = connectionsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = connectionFile(conn.userId);
  writeFileSync(file, `${JSON.stringify(conn, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

async function fileDelete(userId: string): Promise<void> {
  try {
    if (existsSync(connectionFile(userId))) {
      unlinkSync(connectionFile(userId));
    }
  } catch {
    // ignore
  }
}

export async function getGithubConnection(userId: string): Promise<GithubConnection | null> {
  const id = userId.trim();
  if (!id) {
    return null;
  }
  if (sqlStore) {
    return sqlStore.getGithubConnection(id);
  }
  return fileGet(id);
}

export async function putGithubConnection(conn: GithubConnection): Promise<void> {
  const next: GithubConnection = {
    ...conn,
    userId: conn.userId.trim(),
    login: conn.login.trim(),
    accessToken: conn.accessToken.trim(),
    scopes: conn.scopes.trim(),
    updatedAt: conn.updatedAt || new Date().toISOString(),
  };
  if (!next.userId || !next.login || !next.accessToken) {
    throw new Error("github connection is incomplete");
  }
  if (sqlStore) {
    await sqlStore.putGithubConnection(next);
    return;
  }
  await filePut(next);
}

export async function deleteGithubConnection(userId: string): Promise<void> {
  const id = userId.trim();
  if (!id) {
    return;
  }
  if (sqlStore) {
    await sqlStore.deleteGithubConnection(id);
    return;
  }
  await fileDelete(id);
}

function isoDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return undefined;
}

export function mapGithubConnectionRow(row?: Record<string, unknown> | null): GithubConnection | null {
  if (!row) {
    return null;
  }
  return parseConnection(
    {
      login: row.github_login ?? row.login,
      accessToken: row.access_token ?? row.accessToken,
      scopes: row.scopes,
      updatedAt: isoDate(row.updated_at ?? row.updatedAt),
    },
    String(row.user_id ?? row.userId ?? ""),
  );
}

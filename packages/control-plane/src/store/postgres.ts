import type { Automation, Build, Environment, Project, RunEvent } from "@neo-cloud-agent/contracts";
import type { AccountStore, SessionRecord, UserRecord } from "../accounts/types.js";
import type { PersistedRun, WorkerLease } from "./persist.js";

export type SqlQuery = (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  org_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  record JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  run_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  body JSONB NOT NULL,
  PRIMARY KEY (run_id, event_id)
);
CREATE INDEX IF NOT EXISTS events_run_seq ON events (run_id, seq);
CREATE TABLE IF NOT EXISTS worker_leases (
  run_id TEXT PRIMARY KEY,
  lease JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  body JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  env_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  draft BOOLEAN NOT NULL,
  body JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS builds_fingerprint ON builds (fingerprint);
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  body JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  body JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
`;

export interface PostgresMetadataStore extends AccountStore {
  migrate(): Promise<void>;
  saveRun(record: PersistedRun): Promise<void>;
  loadRun(runId: string): Promise<PersistedRun | null>;
  loadRuns(): Promise<PersistedRun[]>;
  saveEvent(event: RunEvent): Promise<void>;
  loadEvents(runId: string): Promise<RunEvent[]>;
  saveLease(lease: WorkerLease): Promise<void>;
  loadLease(runId: string): Promise<WorkerLease | null>;
  deleteLease(runId: string): Promise<void>;
  saveEnvironment(env: Environment): Promise<void>;
  loadEnvironments(): Promise<Environment[]>;
  saveBuild(build: Build): Promise<void>;
  loadBuilds(): Promise<Build[]>;
  saveAutomation(item: Automation): Promise<void>;
  loadAutomations(): Promise<Automation[]>;
  deleteAutomation(id: string): Promise<void>;
  saveProject(item: Project): Promise<void>;
  loadProjects(): Promise<Project[]>;
  deleteProject(id: string): Promise<void>;
}

function asRecord(value: unknown): PersistedRun | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as PersistedRun;
  return record.run?.id ? record : null;
}

function asEvent(value: unknown): RunEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const event = value as RunEvent;
  return event.id && event.runId ? event : null;
}

function asLease(value: unknown): WorkerLease | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const lease = value as WorkerLease;
  return lease.runId && lease.handleId ? lease : null;
}

function asEnvironment(value: unknown): Environment | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const env = value as Environment;
  return env.id ? env : null;
}

function asBuild(value: unknown): Build | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const build = value as Build;
  return build.id && build.envId ? build : null;
}

function asAutomation(value: unknown): Automation | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Automation;
  return item.id && item.prompt && item.schedule ? item : null;
}

function asProject(value: unknown): Project | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Project;
  return item.id && item.name ? item : null;
}

function parseJson<T>(value: unknown, map: (item: unknown) => T | null): T | null {
  if (typeof value === "string") {
    try {
      return map(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return map(value);
}

export function createPostgresMetadataStore(query: SqlQuery): PostgresMetadataStore {
  return {
    async migrate() {
      await query(POSTGRES_SCHEMA);
    },
    async saveRun(record) {
      await query(
        `INSERT INTO runs (id, user_id, org_id, record, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           org_id = EXCLUDED.org_id,
           record = EXCLUDED.record,
           updated_at = EXCLUDED.updated_at`,
        [record.run.id, record.run.userId, record.run.orgId, JSON.stringify(record), record.run.updatedAt],
      );
    },
    async loadRun(runId) {
      const result = await query(`SELECT record FROM runs WHERE id = $1`, [runId]);
      return parseJson(result.rows[0]?.record, asRecord);
    },
    async loadRuns() {
      const result = await query(`SELECT record FROM runs ORDER BY updated_at DESC`);
      return result.rows.map((row) => parseJson(row.record, asRecord)).filter((item): item is PersistedRun => Boolean(item));
    },
    async saveEvent(event) {
      await query(
        `INSERT INTO events (run_id, event_id, seq, body)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (run_id, event_id) DO NOTHING`,
        [event.runId, event.id, event.seq ?? 0, JSON.stringify(event)],
      );
    },
    async loadEvents(runId) {
      const result = await query(`SELECT body FROM events WHERE run_id = $1 ORDER BY seq ASC`, [runId]);
      return result.rows.map((row) => parseJson(row.body, asEvent)).filter((item): item is RunEvent => Boolean(item));
    },
    async saveLease(lease) {
      await query(
        `INSERT INTO worker_leases (run_id, lease, updated_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (run_id) DO UPDATE SET lease = EXCLUDED.lease, updated_at = EXCLUDED.updated_at`,
        [lease.runId, JSON.stringify(lease), lease.updatedAt],
      );
    },
    async loadLease(runId) {
      const result = await query(`SELECT lease FROM worker_leases WHERE run_id = $1`, [runId]);
      return parseJson(result.rows[0]?.lease, asLease);
    },
    async deleteLease(runId) {
      await query(`DELETE FROM worker_leases WHERE run_id = $1`, [runId]);
    },
    async saveEnvironment(env) {
      await query(
        `INSERT INTO environments (id, org_id, body, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           org_id = EXCLUDED.org_id,
           body = EXCLUDED.body,
           updated_at = EXCLUDED.updated_at`,
        [env.id, env.orgId, JSON.stringify(env), env.updatedAt],
      );
    },
    async loadEnvironments() {
      const result = await query(`SELECT body FROM environments ORDER BY updated_at DESC`);
      return result.rows
        .map((row) => parseJson(row.body, asEnvironment))
        .filter((item): item is Environment => Boolean(item));
    },
    async saveBuild(build) {
      await query(
        `INSERT INTO builds (id, env_id, org_id, fingerprint, status, draft, body, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           env_id = EXCLUDED.env_id,
           org_id = EXCLUDED.org_id,
           fingerprint = EXCLUDED.fingerprint,
           status = EXCLUDED.status,
           draft = EXCLUDED.draft,
           body = EXCLUDED.body,
           updated_at = EXCLUDED.updated_at`,
        [
          build.id,
          build.envId,
          build.orgId,
          build.fingerprint,
          build.status,
          build.draft,
          JSON.stringify(build),
          build.completedAt ?? build.createdAt,
        ],
      );
    },
    async loadBuilds() {
      const result = await query(`SELECT body FROM builds ORDER BY updated_at DESC`);
      return result.rows.map((row) => parseJson(row.body, asBuild)).filter((item): item is Build => Boolean(item));
    },
    async saveAutomation(item) {
      await query(
        `INSERT INTO automations (id, body, updated_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at`,
        [item.id, JSON.stringify(item), item.updatedAt],
      );
    },
    async loadAutomations() {
      const result = await query(`SELECT body FROM automations ORDER BY updated_at ASC`);
      return result.rows
        .map((row) => parseJson(row.body, asAutomation))
        .filter((item): item is Automation => Boolean(item));
    },
    async deleteAutomation(id) {
      await query(`DELETE FROM automations WHERE id = $1`, [id]);
    },
    async saveProject(item) {
      await query(
        `INSERT INTO projects (id, body, updated_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at`,
        [item.id, JSON.stringify(item), item.updatedAt],
      );
    },
    async loadProjects() {
      const result = await query(`SELECT body FROM projects ORDER BY updated_at ASC`);
      return result.rows.map((row) => parseJson(row.body, asProject)).filter((item): item is Project => Boolean(item));
    },
    async deleteProject(id) {
      await query(`DELETE FROM projects WHERE id = $1`, [id]);
    },
    async createUser(user) {
      try {
        await query(
          `INSERT INTO users (id, email, password_hash, org_id, created_at)
           VALUES ($1, $2, $3, $4, $5::timestamptz)`,
          [user.id, user.email, user.passwordHash, user.orgId, user.createdAt],
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/unique|duplicate/i.test(message)) {
          throw new Error("email already registered");
        }
        throw error;
      }
      return user;
    },
    async findUserByEmail(email) {
      const result = await query(
        `SELECT id, email, password_hash, org_id, created_at FROM users WHERE email = $1`,
        [email],
      );
      return mapUser(result.rows[0]);
    },
    async findUserById(id) {
      const result = await query(
        `SELECT id, email, password_hash, org_id, created_at FROM users WHERE id = $1`,
        [id],
      );
      return mapUser(result.rows[0]);
    },
    async updateUserPassword(userId, passwordHash) {
      await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, userId]);
    },
    async createSession(session) {
      await query(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (token_hash) DO UPDATE SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at`,
        [session.id, session.userId, session.tokenHash, session.expiresAt, session.createdAt],
      );
    },
    async findSessionByTokenHash(hash) {
      const result = await query(
        `SELECT id, user_id, token_hash, expires_at, created_at FROM sessions WHERE token_hash = $1`,
        [hash],
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return {
        id: String(row.id),
        userId: String(row.user_id),
        tokenHash: String(row.token_hash),
        expiresAt: toIso(row.expires_at),
        createdAt: toIso(row.created_at),
      } satisfies SessionRecord;
    },
    async deleteSession(id) {
      await query(`DELETE FROM sessions WHERE id = $1`, [id]);
    },
  };
}

function mapUser(row?: Record<string, unknown>): UserRecord | null {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    orgId: String(row.org_id),
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

export async function connectPostgres(url: string): Promise<PostgresMetadataStore> {
  const pg = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  const store = createPostgresMetadataStore(async (text, values) => pool.query(text, values));
  await store.migrate();
  return store;
}

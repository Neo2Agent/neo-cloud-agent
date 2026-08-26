import mysql from "mysql2/promise";
import type {
  Automation,
  Build,
  BundledExpertPolicyDocument,
  Desk,
  Device,
  Environment,
  Expert,
  Project,
  RunEvent,
} from "@neo-cloud-agent/contracts";
import { BUNDLED_EXPERT_POLICY_ID } from "@neo-cloud-agent/contracts";
import type { SessionRecord, UserRecord } from "../accounts/types.js";
import type { PersistedRun, WorkerLease } from "./persist.js";
import type { PostgresMetadataStore, SqlQuery } from "./postgres.js";

export type MysqlMetadataStore = PostgresMetadataStore;

export const MYSQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(191) PRIMARY KEY,
  email VARCHAR(191) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  org_id VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  token_hash VARCHAR(191) UNIQUE NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS runs (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  org_id VARCHAR(191) NOT NULL,
  record JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  run_id VARCHAR(191) NOT NULL,
  event_id VARCHAR(191) NOT NULL,
  seq BIGINT NOT NULL,
  body JSON NOT NULL,
  PRIMARY KEY (run_id, event_id),
  KEY events_run_seq (run_id, seq)
);
CREATE TABLE IF NOT EXISTS worker_leases (
  run_id VARCHAR(191) PRIMARY KEY,
  lease JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS environments (
  id VARCHAR(191) PRIMARY KEY,
  org_id VARCHAR(191) NOT NULL,
  body JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS builds (
  id VARCHAR(191) PRIMARY KEY,
  env_id VARCHAR(191) NOT NULL,
  org_id VARCHAR(191) NOT NULL,
  fingerprint VARCHAR(191) NOT NULL,
  status VARCHAR(64) NOT NULL,
  draft TINYINT(1) NOT NULL,
  body JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY builds_fingerprint (fingerprint)
);
CREATE TABLE IF NOT EXISTS automations (
  id VARCHAR(191) PRIMARY KEY,
  body JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(191) PRIMARY KEY,
  body JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS desks (
  id VARCHAR(191) PRIMARY KEY,
  body JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(191) PRIMARY KEY,
  body JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS experts (
  id VARCHAR(191) PRIMARY KEY,
  body JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS expert_policies (
  id VARCHAR(191) PRIMARY KEY,
  body JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL
);
`;

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

function asDesk(value: unknown): Desk | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Desk;
  return item.id && item.userId ? item : null;
}

function asDevice(value: unknown): Device | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Device;
  return item.id && item.userId && (item.platform === "ios" || item.platform === "android") ? item : null;
}

function asProject(value: unknown): Project | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Project;
  return item.id && item.name ? item : null;
}

function asExpert(value: unknown): Expert | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Expert;
  return item.id && item.name && item.persona ? item : null;
}

function asExpertPolicy(value: unknown): BundledExpertPolicyDocument | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as BundledExpertPolicyDocument;
  return item.version === 1 && item.experts && typeof item.experts === "object" ? item : null;
}

function asAutomation(value: unknown): Automation | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Automation;
  return item.id && item.prompt && item.schedule ? item : null;
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

function schemaStatements(schema: string): string[] {
  return schema
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `${part};`);
}

export function createMysqlMetadataStore(query: SqlQuery): MysqlMetadataStore {
  return {
    async migrate() {
      for (const statement of schemaStatements(MYSQL_SCHEMA)) {
        await query(statement);
      }
      for (const statement of [
        "CREATE INDEX events_run_seq ON events (run_id, seq)",
        "CREATE INDEX builds_fingerprint ON builds (fingerprint)",
        "CREATE INDEX runs_updated_at ON runs (updated_at)",
      ]) {
        try {
          await query(statement);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/duplicate key name|already exists/i.test(message)) {
            throw error;
          }
        }
      }
    },
    async saveRun(record) {
      await query(
        `INSERT INTO runs (id, user_id, org_id, record, updated_at)
         VALUES (?, ?, ?, ?, ?) AS incoming
         ON DUPLICATE KEY UPDATE
           user_id = incoming.user_id,
           org_id = incoming.org_id,
           record = incoming.record,
           updated_at = incoming.updated_at`,
        [record.run.id, record.run.userId, record.run.orgId, JSON.stringify(record), mysqlDateTime(record.run.updatedAt)],
      );
    },
    async loadRun(runId) {
      const result = await query(`SELECT record FROM runs WHERE id = ?`, [runId]);
      return parseJson(result.rows[0]?.record, asRecord);
    },
    async loadRuns() {
      // Do not ORDER BY in MySQL: filesort of JSON blobs hits ER_OUT_OF_SORTMEMORY
      // with the default 256KiB sort_buffer_size.
      const result = await query(`SELECT record FROM runs`);
      return result.rows
        .map((row) => parseJson(row.record, asRecord))
        .filter((item): item is PersistedRun => Boolean(item))
        .sort((left, right) => Date.parse(right.run.updatedAt) - Date.parse(left.run.updatedAt));
    },
    async saveEvent(event) {
      await query(
        `INSERT IGNORE INTO events (run_id, event_id, seq, body) VALUES (?, ?, ?, ?)`,
        [event.runId, event.id, event.seq ?? 0, JSON.stringify(event)],
      );
    },
    async loadEvents(runId) {
      const result = await query(`SELECT body FROM events WHERE run_id = ? ORDER BY seq ASC`, [runId]);
      return result.rows.map((row) => parseJson(row.body, asEvent)).filter((item): item is RunEvent => Boolean(item));
    },
    async saveLease(lease) {
      await query(
        `INSERT INTO worker_leases (run_id, lease, updated_at)
         VALUES (?, ?, ?) AS incoming
         ON DUPLICATE KEY UPDATE lease = incoming.lease, updated_at = incoming.updated_at`,
        [lease.runId, JSON.stringify(lease), mysqlDateTime(lease.updatedAt)],
      );
    },
    async loadLease(runId) {
      const result = await query(`SELECT lease FROM worker_leases WHERE run_id = ?`, [runId]);
      return parseJson(result.rows[0]?.lease, asLease);
    },
    async deleteLease(runId) {
      await query(`DELETE FROM worker_leases WHERE run_id = ?`, [runId]);
    },
    async saveEnvironment(env) {
      await query(
        `INSERT INTO environments (id, org_id, body, updated_at)
         VALUES (?, ?, ?, ?) AS incoming
         ON DUPLICATE KEY UPDATE
           org_id = incoming.org_id,
           body = incoming.body,
           updated_at = incoming.updated_at`,
        [env.id, env.orgId, JSON.stringify(env), mysqlDateTime(env.updatedAt)],
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS incoming
         ON DUPLICATE KEY UPDATE
           env_id = incoming.env_id,
           org_id = incoming.org_id,
           fingerprint = incoming.fingerprint,
           status = incoming.status,
           draft = incoming.draft,
           body = incoming.body,
           updated_at = incoming.updated_at`,
        [
          build.id,
          build.envId,
          build.orgId,
          build.fingerprint,
          build.status,
          build.draft ? 1 : 0,
          JSON.stringify(build),
          mysqlDateTime(build.completedAt ?? build.createdAt),
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
         VALUES (?, ?, ?) AS incoming
         ON DUPLICATE KEY UPDATE body = incoming.body, updated_at = incoming.updated_at`,
        [item.id, JSON.stringify(item), mysqlDateTime(item.updatedAt)],
      );
    },
    async loadAutomations() {
      const result = await query(`SELECT body FROM automations ORDER BY updated_at ASC`);
      return result.rows
        .map((row) => parseJson(row.body, asAutomation))
        .filter((item): item is Automation => Boolean(item));
    },
    async deleteAutomation(id) {
      await query(`DELETE FROM automations WHERE id = ?`, [id]);
    },
    async saveProject(item) {
      await query(
        `INSERT INTO projects (id, body, updated_at)
         VALUES (?, ?, ?) AS incoming
         ON DUPLICATE KEY UPDATE body = incoming.body, updated_at = incoming.updated_at`,
        [item.id, JSON.stringify(item), mysqlDateTime(item.updatedAt)],
      );
    },
    async loadProjects() {
      const result = await query(`SELECT body FROM projects ORDER BY updated_at ASC`);
      return result.rows.map((row) => parseJson(row.body, asProject)).filter((item): item is Project => Boolean(item));
    },
    async deleteProject(id) {
      await query(`DELETE FROM projects WHERE id = ?`, [id]);
    },
    async saveExpert(item) {
      await query(
        `INSERT INTO experts (id, body, updated_at)
         VALUES (?, ?, ?) AS incoming
         ON DUPLICATE KEY UPDATE body = incoming.body, updated_at = incoming.updated_at`,
        [item.id, JSON.stringify(item), mysqlDateTime(item.updatedAt)],
      );
    },
    async loadExperts() {
      const result = await query(`SELECT body FROM experts ORDER BY updated_at ASC`);
      return result.rows.map((row) => parseJson(row.body, asExpert)).filter((item): item is Expert => Boolean(item));
    },
    async deleteExpert(id) {
      await query(`DELETE FROM experts WHERE id = ?`, [id]);
    },
    async saveExpertPolicy(item) {
      await query(
        `INSERT INTO expert_policies (id, body, updated_at)
         VALUES (?, ?, ?) AS incoming
         ON DUPLICATE KEY UPDATE body = incoming.body, updated_at = incoming.updated_at`,
        [BUNDLED_EXPERT_POLICY_ID, JSON.stringify(item), mysqlDateTime(item.updatedAt)],
      );
    },
    async loadExpertPolicy() {
      const result = await query(`SELECT body FROM expert_policies WHERE id = ?`, [BUNDLED_EXPERT_POLICY_ID]);
      return parseJson(result.rows[0]?.body, asExpertPolicy);
    },
    async saveDesk(item) {
      await query(
        `INSERT INTO desks (id, body, updated_at)
         VALUES (?, ?, ?) AS incoming
         ON DUPLICATE KEY UPDATE body = incoming.body, updated_at = incoming.updated_at`,
        [item.id, JSON.stringify(item), mysqlDateTime(item.lastSeenAt || item.createdAt)],
      );
    },
    async loadDesks() {
      const result = await query(`SELECT body FROM desks ORDER BY updated_at ASC`);
      return result.rows.map((row) => parseJson(row.body, asDesk)).filter((item): item is Desk => Boolean(item));
    },
    async deleteDesk(id) {
      await query(`DELETE FROM desks WHERE id = ?`, [id]);
    },
    async saveDevice(item) {
      await query(
        `INSERT INTO devices (id, body, updated_at)
         VALUES (?, ?, ?) AS incoming
         ON DUPLICATE KEY UPDATE body = incoming.body, updated_at = incoming.updated_at`,
        [item.id, JSON.stringify(item), mysqlDateTime(item.lastSeenAt || item.createdAt)],
      );
    },
    async loadDevices() {
      const result = await query(`SELECT body FROM devices ORDER BY updated_at ASC`);
      return result.rows.map((row) => parseJson(row.body, asDevice)).filter((item): item is Device => Boolean(item));
    },
    async deleteDevice(id) {
      await query(`DELETE FROM devices WHERE id = ?`, [id]);
    },
    async createUser(user) {
      try {
        await query(
          `INSERT INTO users (id, email, password_hash, org_id, created_at) VALUES (?, ?, ?, ?, ?)`,
          [user.id, user.email, user.passwordHash, user.orgId, mysqlDateTime(user.createdAt)],
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
        `SELECT id, email, password_hash, org_id, created_at FROM users WHERE email = ?`,
        [email],
      );
      return mapUser(result.rows[0]);
    },
    async findUserById(id) {
      const result = await query(
        `SELECT id, email, password_hash, org_id, created_at FROM users WHERE id = ?`,
        [id],
      );
      return mapUser(result.rows[0]);
    },
    async listUsers() {
      const result = await query(
        `SELECT id, email, password_hash, org_id, created_at FROM users ORDER BY created_at ASC`,
      );
      return result.rows.map((row) => mapUser(row)).filter((item): item is UserRecord => Boolean(item));
    },
    async updateUserPassword(userId, passwordHash) {
      await query(`UPDATE users SET password_hash = ? WHERE id = ?`, [passwordHash, userId]);
    },
    async createSession(session) {
      await query(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?) AS incoming
         ON DUPLICATE KEY UPDATE user_id = incoming.user_id, expires_at = incoming.expires_at`,
        [session.id, session.userId, session.tokenHash, mysqlDateTime(session.expiresAt), mysqlDateTime(session.createdAt)],
      );
    },
    async findSessionByTokenHash(hash) {
      const result = await query(
        `SELECT id, user_id, token_hash, expires_at, created_at FROM sessions WHERE token_hash = ?`,
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
      await query(`DELETE FROM sessions WHERE id = ?`, [id]);
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

function mysqlDateTime(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toISOString().replace("T", " ").replace("Z", "");
}

export function mysqlPoolOptions(url: string): mysql.PoolOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    waitForConnections: true,
    connectionLimit: 8,
    timezone: "Z",
    dateStrings: false,
  };
}

export async function connectMysql(url: string): Promise<MysqlMetadataStore> {
  const pool = mysql.createPool(mysqlPoolOptions(url));
  const store = createMysqlMetadataStore(async (text, values) => {
    const [rows] = await pool.query(text, values ?? []);
    return { rows: Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [] };
  });
  await store.migrate();
  return store;
}

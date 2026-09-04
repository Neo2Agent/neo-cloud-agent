import type {
  Automation,
  Build,
  BundledExpertPolicyDocument,
  Desk,
  Device,
  Environment,
  Expert,
  PluginInstall,
  Project,
  Run,
  RunEvent,
} from "@neo-cloud-agent/contracts";
import { BUNDLED_EXPERT_POLICY_ID } from "@neo-cloud-agent/contracts";
import {
  applyAccountPatch,
  applyAvatarPatch,
  parseStoredAvatar,
  serializeStoredAvatar,
  type AccountStatus,
  type AccountStore,
  type SessionRecord,
  type UserRecord,
} from "../accounts/types.js";
import type { PersistedRun, WorkerLease } from "./persist.js";
import { persistableRecord } from "./persist.js";
import {
  mergeStoredRun,
  overlayRunIndex,
  parseJson,
  parseQueue,
  queueFromRecord,
  recordHasEmbeddedQueue,
  recordHasQueueKeys,
  runIndexTitle,
  slimRunDocument,
  type RunQueueState,
} from "./run-record.js";

export type SqlQuery = (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  org_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  credit_fen INTEGER NOT NULL DEFAULT 0,
  avatar_json TEXT,
  neo_avatar_json TEXT
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
  title TEXT,
  status TEXT,
  project_id TEXT,
  record JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS runs_updated_at ON runs (updated_at);
CREATE INDEX IF NOT EXISTS runs_status ON runs (status);
CREATE INDEX IF NOT EXISTS runs_project_id ON runs (project_id);
CREATE TABLE IF NOT EXISTS run_queues (
  run_id TEXT PRIMARY KEY,
  follow_ups JSONB NOT NULL,
  inbound JSONB NOT NULL,
  subscriptions JSONB NOT NULL,
  active_turn JSONB,
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
CREATE TABLE IF NOT EXISTS desks (
  id TEXT PRIMARY KEY,
  body JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  body JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS experts (
  id TEXT PRIMARY KEY,
  body JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS expert_policies (
  id TEXT PRIMARY KEY,
  body JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS plugin_installs (
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
  loadRunSummaries(): Promise<Run[]>;
  loadRunQueues(): Promise<Array<readonly [string, RunQueueState]>>;
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
  saveExpert(item: Expert): Promise<void>;
  loadExperts(): Promise<Expert[]>;
  deleteExpert(id: string): Promise<void>;
  saveExpertPolicy(item: BundledExpertPolicyDocument): Promise<void>;
  loadExpertPolicy(): Promise<BundledExpertPolicyDocument | null>;
  savePluginInstall(item: PluginInstall): Promise<void>;
  loadPluginInstalls(): Promise<PluginInstall[]>;
  deletePluginInstall(id: string): Promise<void>;
  saveDesk(item: Desk): Promise<void>;
  loadDesks(): Promise<Desk[]>;
  deleteDesk(id: string): Promise<void>;
  saveDevice(item: Device): Promise<void>;
  loadDevices(): Promise<Device[]>;
  deleteDevice(id: string): Promise<void>;
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
  if (!item.id || !item.name) return null;
  return { ...item, expertIds: item.expertIds ?? [], pluginIds: item.pluginIds ?? [] };
}

function asExpert(value: unknown): Expert | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Expert;
  return item.id && item.name && item.persona ? item : null;
}

function asPluginInstall(value: unknown): PluginInstall | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as PluginInstall;
  return item.id && item.pluginId ? item : null;
}

function asExpertPolicy(value: unknown): BundledExpertPolicyDocument | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as BundledExpertPolicyDocument;
  return item.version === 1 && item.experts && typeof item.experts === "object" ? item : null;
}

async function writeRunQueue(query: SqlQuery, record: PersistedRun): Promise<void> {
  const queue = queueFromRecord(record);
  await query(
    `INSERT INTO run_queues (run_id, follow_ups, inbound, subscriptions, active_turn, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::timestamptz)
     ON CONFLICT (run_id) DO UPDATE SET
       follow_ups = EXCLUDED.follow_ups,
       inbound = EXCLUDED.inbound,
       subscriptions = EXCLUDED.subscriptions,
       active_turn = EXCLUDED.active_turn,
       updated_at = EXCLUDED.updated_at`,
    [
      record.run.id,
      JSON.stringify(queue.followUps),
      JSON.stringify(queue.inbound),
      JSON.stringify(queue.subscriptions),
      queue.activeTurn ? JSON.stringify(queue.activeTurn) : null,
      record.run.updatedAt,
    ],
  );
}

async function readRunQueue(query: SqlQuery, runId: string): Promise<RunQueueState | null> {
  const result = await query(
    `SELECT follow_ups, inbound, subscriptions, active_turn FROM run_queues WHERE run_id = $1`,
    [runId],
  );
  const row = result.rows[0];
  return row
    ? parseQueue({
        follow_ups: row.follow_ups,
        inbound: row.inbound,
        subscriptions: row.subscriptions,
        active_turn: row.active_turn,
      })
    : null;
}

async function backfillSplitRunRecords(query: SqlQuery): Promise<void> {
  const result = await query(`SELECT id, title, record FROM runs`);
  for (const row of result.rows) {
    const merged = mergeStoredRun(row.record);
    if (!merged) {
      continue;
    }
    const embedded = recordHasEmbeddedQueue(merged) || recordHasQueueKeys(row.record);
    if (!embedded && typeof row.title === "string" && row.title.trim()) {
      continue;
    }
    const stored = persistableRecord(merged);
    if (embedded) {
      await writeRunQueue(query, stored);
    }
    await query(`UPDATE runs SET record = $1::jsonb, title = $2, status = $3, project_id = $4 WHERE id = $5`, [
      JSON.stringify(slimRunDocument(stored)),
      runIndexTitle(stored.run),
      stored.run.status,
      stored.run.projectId ?? null,
      stored.run.id,
    ]);
  }
}

export function createPostgresMetadataStore(query: SqlQuery): PostgresMetadataStore {
  return {
    async migrate() {
      await query(POSTGRES_SCHEMA);
      for (const statement of [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_json TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS neo_avatar_json TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT",
        "CREATE UNIQUE INDEX IF NOT EXISTS users_phone ON users (phone)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS credit_fen INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE runs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
        "CREATE INDEX IF NOT EXISTS runs_deleted_at ON runs (deleted_at)",
        "ALTER TABLE runs ADD COLUMN IF NOT EXISTS title TEXT",
        "ALTER TABLE runs ADD COLUMN IF NOT EXISTS status TEXT",
        "ALTER TABLE runs ADD COLUMN IF NOT EXISTS project_id TEXT",
        "CREATE INDEX IF NOT EXISTS runs_status ON runs (status)",
        "CREATE INDEX IF NOT EXISTS runs_project_id ON runs (project_id)",
      ]) {
        await query(statement);
      }
      await backfillSplitRunRecords(query);
    },
    async saveRun(record) {
      const stored = persistableRecord(record);
      await query(
        `INSERT INTO runs (id, user_id, org_id, title, status, project_id, record, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           org_id = EXCLUDED.org_id,
           title = EXCLUDED.title,
           status = EXCLUDED.status,
           project_id = EXCLUDED.project_id,
           record = EXCLUDED.record,
           updated_at = EXCLUDED.updated_at,
           deleted_at = EXCLUDED.deleted_at`,
        [
          stored.run.id,
          stored.run.userId,
          stored.run.orgId,
          runIndexTitle(stored.run),
          stored.run.status,
          stored.run.projectId ?? null,
          JSON.stringify(slimRunDocument(stored)),
          stored.run.updatedAt,
          stored.run.deletedAt ?? null,
        ],
      );
      await writeRunQueue(query, stored);
    },
    async loadRun(runId) {
      const result = await query(`SELECT record FROM runs WHERE id = $1`, [runId]);
      return mergeStoredRun(result.rows[0]?.record, await readRunQueue(query, runId));
    },
    async loadRuns() {
      const result = await query(
        `SELECT r.record, q.follow_ups, q.inbound, q.subscriptions, q.active_turn
         FROM runs r
         LEFT JOIN run_queues q ON q.run_id = r.id
         WHERE r.deleted_at IS NULL
         ORDER BY r.updated_at DESC`,
      );
      return result.rows
        .map((row) =>
          mergeStoredRun(row.record, {
            follow_ups: row.follow_ups,
            inbound: row.inbound,
            subscriptions: row.subscriptions,
            active_turn: row.active_turn,
          }),
        )
        .filter((item): item is PersistedRun => item != null && !item.run.deletedAt);
    },
    async loadRunSummaries() {
      const result = await query(
        `SELECT title, status, project_id, record
         FROM runs WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
      );
      return result.rows
        .map((row) => {
          const parsed = mergeStoredRun(row.record);
          return parsed ? overlayRunIndex(parsed.run, row) : null;
        })
        .filter((item): item is Run => item != null && !item.deletedAt);
    },
    async loadRunQueues() {
      const result = await query(`SELECT run_id, follow_ups, inbound, subscriptions, active_turn FROM run_queues`);
      return result.rows
        .map((row) => {
          const queue = parseQueue({
            follow_ups: row.follow_ups,
            inbound: row.inbound,
            subscriptions: row.subscriptions,
            active_turn: row.active_turn,
          });
          return queue ? ([String(row.run_id), queue] as const) : null;
        })
        .filter((item): item is readonly [string, RunQueueState] => item != null);
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
    async saveExpert(item) {
      await query(
        `INSERT INTO experts (id, body, updated_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at`,
        [item.id, JSON.stringify(item), item.updatedAt],
      );
    },
    async loadExperts() {
      const result = await query(`SELECT body FROM experts ORDER BY updated_at ASC`);
      return result.rows.map((row) => parseJson(row.body, asExpert)).filter((item): item is Expert => Boolean(item));
    },
    async deleteExpert(id) {
      await query(`DELETE FROM experts WHERE id = $1`, [id]);
    },
    async saveExpertPolicy(item) {
      await query(
        `INSERT INTO expert_policies (id, body, updated_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at`,
        [BUNDLED_EXPERT_POLICY_ID, JSON.stringify(item), item.updatedAt],
      );
    },
    async loadExpertPolicy() {
      const result = await query(`SELECT body FROM expert_policies WHERE id = $1`, [BUNDLED_EXPERT_POLICY_ID]);
      return parseJson(result.rows[0]?.body, asExpertPolicy);
    },
    async savePluginInstall(item) {
      await query(
        `INSERT INTO plugin_installs (id, body, updated_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at`,
        [item.id, JSON.stringify(item), item.updatedAt],
      );
    },
    async loadPluginInstalls() {
      const result = await query(`SELECT body FROM plugin_installs ORDER BY updated_at ASC`);
      return result.rows.map((row) => parseJson(row.body, asPluginInstall)).filter((item): item is PluginInstall => Boolean(item));
    },
    async deletePluginInstall(id) {
      await query(`DELETE FROM plugin_installs WHERE id = $1`, [id]);
    },
    async saveDesk(item) {
      await query(
        `INSERT INTO desks (id, body, updated_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at`,
        [item.id, JSON.stringify(item), item.lastSeenAt || item.createdAt],
      );
    },
    async loadDesks() {
      const result = await query(`SELECT body FROM desks ORDER BY updated_at ASC`);
      return result.rows.map((row) => parseJson(row.body, asDesk)).filter((item): item is Desk => Boolean(item));
    },
    async deleteDesk(id) {
      await query(`DELETE FROM desks WHERE id = $1`, [id]);
    },
    async saveDevice(item) {
      await query(
        `INSERT INTO devices (id, body, updated_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at`,
        [item.id, JSON.stringify(item), item.lastSeenAt || item.createdAt],
      );
    },
    async loadDevices() {
      const result = await query(`SELECT body FROM devices ORDER BY updated_at ASC`);
      return result.rows.map((row) => parseJson(row.body, asDevice)).filter((item): item is Device => Boolean(item));
    },
    async deleteDevice(id) {
      await query(`DELETE FROM devices WHERE id = $1`, [id]);
    },
    async createUser(user) {
      try {
        await query(
          `INSERT INTO users (id, email, phone, password_hash, org_id, created_at, status, credit_fen)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8)`,
          [
            user.id,
            user.email,
            user.phone ?? null,
            user.passwordHash,
            user.orgId,
            user.createdAt,
            user.status ?? "active",
            user.creditFen ?? 0,
          ],
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/unique|duplicate/i.test(message)) {
          throw new Error(/phone/i.test(message) ? "phone already registered" : "email already registered");
        }
        throw error;
      }
      return user;
    },
    async findUserByEmail(email) {
      const result = await query(
        `SELECT id, email, phone, password_hash, org_id, created_at, status, credit_fen, avatar_json, neo_avatar_json FROM users WHERE email = $1`,
        [email],
      );
      return mapUser(result.rows[0]);
    },
    async findUserByPhone(phone) {
      if (!phone) {
        return null;
      }
      const result = await query(
        `SELECT id, email, phone, password_hash, org_id, created_at, status, credit_fen, avatar_json, neo_avatar_json FROM users WHERE phone = $1`,
        [phone],
      );
      return mapUser(result.rows[0]);
    },
    async findUserById(id) {
      const result = await query(
        `SELECT id, email, phone, password_hash, org_id, created_at, status, credit_fen, avatar_json, neo_avatar_json FROM users WHERE id = $1`,
        [id],
      );
      return mapUser(result.rows[0]);
    },
    async listUsers() {
      const result = await query(
        `SELECT id, email, phone, password_hash, org_id, created_at, status, credit_fen, avatar_json, neo_avatar_json FROM users ORDER BY created_at ASC`,
      );
      return result.rows.map((row) => mapUser(row)).filter((item): item is UserRecord => Boolean(item));
    },
    async updateUserAccount(userId, patch) {
      const result = await query(
        `SELECT id, email, phone, password_hash, org_id, created_at, status, credit_fen, avatar_json, neo_avatar_json FROM users WHERE id = $1`,
        [userId],
      );
      const user = mapUser(result.rows[0]);
      if (!user) {
        throw new Error("user not found");
      }
      const next = applyAccountPatch(user, patch);
      await query(`UPDATE users SET status = $1, credit_fen = $2 WHERE id = $3`, [next.status ?? "active", next.creditFen ?? 0, userId]);
      return next;
    },
    async updateUserPassword(userId, passwordHash) {
      await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, userId]);
    },
    async updateUserAvatars(userId, patch) {
      const result = await query(
        `SELECT id, email, phone, password_hash, org_id, created_at, status, credit_fen, avatar_json, neo_avatar_json FROM users WHERE id = $1`,
        [userId],
      );
      const user = mapUser(result.rows[0]);
      if (!user) {
        throw new Error("user not found");
      }
      const next = applyAvatarPatch(user, patch);
      await query(`UPDATE users SET avatar_json = $1, neo_avatar_json = $2 WHERE id = $3`, [
        serializeStoredAvatar(next.avatar),
        serializeStoredAvatar(next.neoAvatar),
        userId,
      ]);
      return next;
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
  const phone = row.phone == null || row.phone === "" ? undefined : String(row.phone);
  const status = row.status === "pending" || row.status === "disabled" ? (row.status as AccountStatus) : "active";
  const creditFen = Number(row.credit_fen ?? 0);
  return {
    id: String(row.id),
    email: String(row.email),
    ...(phone ? { phone } : {}),
    passwordHash: String(row.password_hash),
    orgId: String(row.org_id),
    createdAt: toIso(row.created_at),
    status,
    creditFen: Number.isFinite(creditFen) ? Math.max(0, Math.floor(creditFen)) : 0,
    avatar: parseStoredAvatar(row.avatar_json),
    neoAvatar: parseStoredAvatar(row.neo_avatar_json),
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

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { controlStateDir } from "../store/persist.js";
import { applyAvatarPatch, type AccountStore, type SessionRecord, type UserRecord } from "./types.js";

type Snapshot = {
  users: UserRecord[];
  sessions: SessionRecord[];
};

function empty(): Snapshot {
  return { users: [], sessions: [] };
}

export function createFileAccountStore(runsDir?: string): AccountStore {
  const file = path.join(controlStateDir(runsDir), "accounts.json");

  const read = (): Snapshot => {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
      return {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
    } catch {
      return empty();
    }
  };

  const write = (snapshot: Snapshot): void => {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`);
    renameSync(tmp, file);
  };

  return {
    async createUser(user) {
      const snapshot = read();
      if (snapshot.users.some((item) => item.email === user.email)) {
        throw new Error("email already registered");
      }
      if (user.phone && snapshot.users.some((item) => item.phone === user.phone)) {
        throw new Error("phone already registered");
      }
      snapshot.users.push(user);
      write(snapshot);
      return user;
    },
    async findUserByEmail(email) {
      return read().users.find((item) => item.email === email) ?? null;
    },
    async findUserByPhone(phone) {
      if (!phone) {
        return null;
      }
      return read().users.find((item) => item.phone === phone) ?? null;
    },
    async findUserById(id) {
      return read().users.find((item) => item.id === id) ?? null;
    },
    async listUsers() {
      return [...read().users].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
    async updateUserPassword(userId, passwordHash) {
      const snapshot = read();
      const user = snapshot.users.find((item) => item.id === userId);
      if (!user) {
        throw new Error("user not found");
      }
      user.passwordHash = passwordHash;
      write(snapshot);
    },
    async updateUserAvatars(userId, patch) {
      const snapshot = read();
      const index = snapshot.users.findIndex((item) => item.id === userId);
      const user = snapshot.users[index];
      if (index < 0 || !user) {
        throw new Error("user not found");
      }
      snapshot.users[index] = applyAvatarPatch(user, patch);
      write(snapshot);
      return snapshot.users[index]!;
    },
    async createSession(session) {
      const snapshot = read();
      snapshot.sessions = snapshot.sessions.filter((item) => item.tokenHash !== session.tokenHash);
      snapshot.sessions.push(session);
      write(snapshot);
    },
    async findSessionByTokenHash(hash) {
      return read().sessions.find((item) => item.tokenHash === hash) ?? null;
    },
    async deleteSession(id) {
      const snapshot = read();
      snapshot.sessions = snapshot.sessions.filter((item) => item.id !== id);
      write(snapshot);
    },
  };
}

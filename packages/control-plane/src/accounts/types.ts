export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  orgId: string;
  createdAt: string;
};

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

export type PublicUser = {
  id: string;
  email: string;
  orgId: string;
  createdAt: string;
};

export interface AccountStore {
  createUser(user: UserRecord): Promise<UserRecord>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  createSession(session: SessionRecord): Promise<void>;
  findSessionByTokenHash(hash: string): Promise<SessionRecord | null>;
  deleteSession(id: string): Promise<void>;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, orgId: user.orgId, createdAt: user.createdAt };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Local admin usernames like `admin`, or a normal email. */
export function isValidLogin(login: string): boolean {
  return isValidEmail(login) || /^[a-z][a-z0-9._-]{1,31}$/.test(login);
}

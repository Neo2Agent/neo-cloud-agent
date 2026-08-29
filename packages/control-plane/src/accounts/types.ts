export type UserAvatar = {
  contentType: string;
  data: string;
};

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  orgId: string;
  createdAt: string;
  avatar?: UserAvatar;
  neoAvatar?: UserAvatar;
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
  avatar: string | null;
  neoAvatar: string | null;
};

export type UserAvatarPatch = {
  avatar?: UserAvatar | null;
  neoAvatar?: UserAvatar | null;
};

export interface AccountStore {
  createUser(user: UserRecord): Promise<UserRecord>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  listUsers(): Promise<UserRecord[]>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  updateUserAvatars(userId: string, patch: UserAvatarPatch): Promise<UserRecord>;
  createSession(session: SessionRecord): Promise<void>;
  findSessionByTokenHash(hash: string): Promise<SessionRecord | null>;
  deleteSession(id: string): Promise<void>;
}

export function avatarDataUrl(avatar?: UserAvatar | null): string | null {
  if (!avatar?.contentType || !avatar.data) {
    return null;
  }
  return `data:${avatar.contentType};base64,${avatar.data}`;
}

export function parseStoredAvatar(value: unknown): UserAvatar | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const raw = typeof value === "string" ? JSON.parse(value) : value;
    if (!raw || typeof raw !== "object") {
      return undefined;
    }
    const item = raw as { contentType?: unknown; data?: unknown };
    if (typeof item.contentType === "string" && typeof item.data === "string" && item.contentType && item.data) {
      return { contentType: item.contentType, data: item.data };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function serializeStoredAvatar(avatar: UserAvatar | null | undefined): string | null {
  return avatar ? JSON.stringify(avatar) : null;
}

export function applyAvatarPatch(user: UserRecord, patch: UserAvatarPatch): UserRecord {
  const next = { ...user };
  if (patch.avatar !== undefined) {
    if (patch.avatar) {
      next.avatar = patch.avatar;
    } else {
      delete next.avatar;
    }
  }
  if (patch.neoAvatar !== undefined) {
    if (patch.neoAvatar) {
      next.neoAvatar = patch.neoAvatar;
    } else {
      delete next.neoAvatar;
    }
  }
  return next;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    orgId: user.orgId,
    createdAt: user.createdAt,
    avatar: avatarDataUrl(user.avatar),
    neoAvatar: avatarDataUrl(user.neoAvatar),
  };
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

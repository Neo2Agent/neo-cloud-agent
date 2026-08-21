import { createHash, randomBytes } from "node:crypto";
import { getConfig } from "../config.js";
import { hashPassword, verifyPassword } from "./password.js";
import { getAccountStore } from "./store.js";
import { isValidEmail, normalizeEmail, toPublicUser, type PublicUser, type SessionRecord } from "./types.js";

export const SESSION_COOKIE = "neo_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintSessionToken(): string {
  return `neo_sess_${randomBytes(24).toString("base64url")}`;
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function registerAccount(input: { email?: string; password?: string }): Promise<{ user: PublicUser; token: string }> {
  const email = normalizeEmail(input.email ?? "");
  const password = input.password ?? "";
  if (!isValidEmail(email)) {
    throw new AccountError("valid email is required", 400);
  }
  if (password.length < 8) {
    throw new AccountError("password must be at least 8 characters", 400);
  }
  const existing = await getAccountStore().findUserByEmail(email);
  if (existing) {
    throw new AccountError("email already registered", 409);
  }
  const now = new Date().toISOString();
  const user = await getAccountStore().createUser({
    id: crypto.randomUUID(),
    email,
    passwordHash: hashPassword(password),
    orgId: getConfig().orgId,
    createdAt: now,
  });
  const token = await issueSession(user.id);
  return { user: toPublicUser(user), token };
}

export async function loginAccount(input: { email?: string; password?: string }): Promise<{ user: PublicUser; token: string }> {
  const email = normalizeEmail(input.email ?? "");
  const password = input.password ?? "";
  const user = await getAccountStore().findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AccountError("invalid email or password", 401);
  }
  const token = await issueSession(user.id);
  return { user: toPublicUser(user), token };
}

export async function lookupSession(token: string): Promise<{ user: PublicUser; session: SessionRecord } | null> {
  if (!token.startsWith("neo_sess_")) {
    return null;
  }
  const session = await getAccountStore().findSessionByTokenHash(hashSessionToken(token));
  if (!session) {
    return null;
  }
  if (Date.parse(session.expiresAt) <= Date.now()) {
    await getAccountStore().deleteSession(session.id);
    return null;
  }
  const user = await getAccountStore().findUserById(session.userId);
  if (!user) {
    return null;
  }
  return { user: toPublicUser(user), session };
}

export async function logoutSession(token: string | null): Promise<void> {
  if (!token) {
    return;
  }
  const found = await lookupSession(token);
  if (found) {
    await getAccountStore().deleteSession(found.session.id);
  }
}

async function issueSession(userId: string): Promise<string> {
  const token = mintSessionToken();
  const now = Date.now();
  await getAccountStore().createSession({
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashSessionToken(token),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  });
  return token;
}

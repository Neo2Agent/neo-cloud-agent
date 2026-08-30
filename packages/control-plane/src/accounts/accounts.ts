import { createHash, randomBytes } from "node:crypto";
import { getConfig } from "../config.js";
import { hashPassword, verifyPassword } from "./password.js";
import { accountStoreKind, getAccountStore } from "./store.js";
import { AvatarError, parseAvatarInput } from "./avatars.js";
import {
  accountStatus,
  isActiveAccount,
  isValidLogin,
  isValidPhone,
  isValidUsername,
  normalizeEmail,
  normalizePhone,
  toPublicUser,
  type PublicUser,
  type SessionRecord,
} from "./types.js";
import { signupCreditFen } from "../quota/quota.js";

export const DEFAULT_ADMIN_LOGIN = "admin";
export const DEFAULT_ADMIN_PASSWORD = "123456";

export const SESSION_COOKIE = "neo_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionCookieName(): string {
  const raw = process.env.SESSION_COOKIE_NAME?.trim();
  return raw || SESSION_COOKIE;
}

export function sessionCookiePath(): string {
  const raw = process.env.SESSION_COOKIE_PATH?.trim();
  if (!raw) {
    return "/";
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintSessionToken(): string {
  return `neo_sess_${randomBytes(24).toString("base64url")}`;
}

export function sessionCookieHeader(token: string): string {
  return `${sessionCookieName()}=${encodeURIComponent(token)}; Path=${sessionCookiePath()}; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookieHeader(): string {
  return `${sessionCookieName()}=; Path=${sessionCookiePath()}; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function defaultAdminEnabled(): boolean {
  return process.env.DEFAULT_ADMIN !== "0" && process.env.DEFAULT_ADMIN !== "false";
}

export function bootstrapPassword(): string {
  return defaultAdminEnabled() ? DEFAULT_ADMIN_PASSWORD : "";
}

export function bootstrapEmail(): string | null {
  return defaultAdminEnabled() ? DEFAULT_ADMIN_LOGIN : null;
}

function requireAccountDatabase(): void {
  const url = (process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    return;
  }
  const mysql = /^mysql:|^mariadb:/i.test(url);
  if (mysql && accountStoreKind() !== "mysql") {
    throw new AccountError("账号库未连接", 503);
  }
}

/** Seed or reset the hardcoded `admin` / `123456` row. */
export async function ensureDefaultAdmin(): Promise<PublicUser | null> {
  if (!defaultAdminEnabled()) {
    return null;
  }
  requireAccountDatabase();
  const store = getAccountStore();
  const existing = await store.findUserByEmail(DEFAULT_ADMIN_LOGIN);
  if (!existing) {
    const user = await store.createUser({
      id: crypto.randomUUID(),
      email: DEFAULT_ADMIN_LOGIN,
      passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
      orgId: getConfig().orgId,
      createdAt: new Date().toISOString(),
      status: "active",
      creditFen: 0,
    });
    console.log("default admin account ready: admin");
    return toPublicUser(user);
  }
  if (!verifyPassword(DEFAULT_ADMIN_PASSWORD, existing.passwordHash)) {
    await store.updateUserPassword(existing.id, hashPassword(DEFAULT_ADMIN_PASSWORD));
  }
  return toPublicUser(existing);
}

/** @deprecated Extra bootstrap emails are no longer created. */
export async function ensureBootstrapAccount(): Promise<PublicUser | null> {
  return ensureDefaultAdmin();
}

export async function registerAccount(input: {
  email?: string;
  username?: string;
  phone?: string;
  password?: string;
}): Promise<{ user: PublicUser; pending: true }> {
  requireAccountDatabase();
  const username = normalizeEmail(input.username ?? input.email ?? "");
  const phone = normalizePhone(input.phone ?? "");
  const password = input.password ?? "";
  if (!isValidUsername(username) || username === DEFAULT_ADMIN_LOGIN) {
    throw new AccountError("用户名不合法", 400);
  }
  if (!isValidPhone(phone)) {
    throw new AccountError("请填写有效的手机号", 400);
  }
  if (password.length < 6) {
    throw new AccountError("密码至少 6 位", 400);
  }
  const store = getAccountStore();
  if (await store.findUserByEmail(username)) {
    throw new AccountError("用户名已存在", 409);
  }
  if (await store.findUserByPhone(phone)) {
    throw new AccountError("手机号已注册", 409);
  }
  let user;
  try {
    user = await store.createUser({
      id: crypto.randomUUID(),
      email: username,
      phone,
      passwordHash: hashPassword(password),
      orgId: getConfig().orgId,
      createdAt: new Date().toISOString(),
      status: "pending",
      creditFen: signupCreditFen(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("phone already registered")) {
      throw new AccountError("手机号已注册", 409);
    }
    if (message.includes("already registered")) {
      throw new AccountError("用户名已存在", 409);
    }
    throw error;
  }
  return { user: toPublicUser(user), pending: true };
}

export async function loginAccount(input: {
  email?: string;
  login?: string;
  phone?: string;
  password?: string;
}): Promise<{ user: PublicUser; token: string }> {
  requireAccountDatabase();
  const raw = (input.login ?? input.phone ?? input.email ?? "").trim();
  const password = input.password ?? "";
  const phone = normalizePhone(raw);
  const login = normalizeEmail(raw);
  if ((!isValidPhone(phone) && !isValidLogin(login)) || !password) {
    throw new AccountError("invalid account or password", 401);
  }
  await ensureDefaultAdmin();
  const store = getAccountStore();
  const user = isValidPhone(phone) ? await store.findUserByPhone(phone) : await store.findUserByEmail(login);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AccountError("invalid account or password", 401);
  }
  if (accountStatus(user) === "pending") {
    throw new AccountError("账号待管理员审核", 403);
  }
  if (!isActiveAccount(user)) {
    throw new AccountError("账号已停用", 403);
  }
  const token = await issueSession(user.id);
  return { user: toPublicUser(user), token };
}

export async function approveAccount(userId: string): Promise<PublicUser> {
  requireAccountDatabase();
  const store = getAccountStore();
  const existing = await store.findUserById(userId);
  if (!existing) {
    throw new AccountError("用户不存在", 404);
  }
  const creditFen = existing.creditFen && existing.creditFen > 0 ? existing.creditFen : signupCreditFen();
  const user = await store.updateUserAccount(userId, { status: "active", creditFen });
  return toPublicUser(user);
}

export async function createTeammateAccount(input: { email: string; password: string; orgId: string }): Promise<PublicUser> {
  requireAccountDatabase();
  const login = normalizeEmail(input.email);
  if (!isValidLogin(login) || login === DEFAULT_ADMIN_LOGIN) {
    throw new AccountError("账号不合法", 400);
  }
  if (input.password.length < 6) {
    throw new AccountError("密码至少 6 位", 400);
  }
  const existing = await getAccountStore().findUserByEmail(login);
  if (existing) {
    throw new AccountError("账号已存在", 409);
  }
  const user = await getAccountStore().createUser({
    id: crypto.randomUUID(),
    email: login,
    passwordHash: hashPassword(input.password),
    orgId: input.orgId,
    createdAt: new Date().toISOString(),
    status: "active",
    creditFen: 0,
  });
  return toPublicUser(user);
}

export async function findPublicUserByEmail(email: string): Promise<PublicUser | null> {
  const user = await getAccountStore().findUserByEmail(normalizeEmail(email));
  return user ? toPublicUser(user) : null;
}

export async function findPublicUserById(id: string): Promise<PublicUser | null> {
  const user = await getAccountStore().findUserById(id);
  return user ? toPublicUser(user) : null;
}

export async function listPublicUsers(): Promise<PublicUser[]> {
  const users = await getAccountStore().listUsers();
  return users.map(toPublicUser);
}

export async function patchUserAvatars(
  userId: string,
  input: { avatar?: unknown; neoAvatar?: unknown },
): Promise<PublicUser> {
  try {
    const user = await getAccountStore().updateUserAvatars(userId, {
      avatar: parseAvatarInput(input.avatar),
      neoAvatar: parseAvatarInput(input.neoAvatar),
    });
    return toPublicUser(user);
  } catch (error) {
    if (error instanceof AvatarError) {
      throw new AccountError(error.message, 400);
    }
    if (error instanceof Error && error.message === "user not found") {
      throw new AccountError("unauthorized", 401);
    }
    throw error;
  }
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
  if (!user || !isActiveAccount(user)) {
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

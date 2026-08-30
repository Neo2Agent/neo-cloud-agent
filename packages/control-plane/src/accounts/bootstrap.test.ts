import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-bootstrap-"));
delete process.env.DATABASE_URL;
delete process.env.BOOTSTRAP_EMAIL;
delete process.env.BOOTSTRAP_PASSWORD;

const {
  bootstrapEmail,
  DEFAULT_ADMIN_LOGIN,
  ensureBootstrapAccount,
  ensureDefaultAdmin,
  loginAccount,
  registerAccount,
  approveAccount,
} = await import("./accounts.js");
const { getAccountStore } = await import("./store.js");
const { hashPassword } = await import("./password.js");

test("admin still logs in and phone registration is unique", async () => {
  const admin = await ensureDefaultAdmin();
  assert.equal(admin?.email, DEFAULT_ADMIN_LOGIN);
  assert.equal(bootstrapEmail(), "admin");
  const session = await loginAccount({ email: "Admin", password: "123456" });
  assert.equal(session.user.email, "admin");
  assert.match(session.token, /^neo_sess_/);
  await assert.rejects(() => loginAccount({ email: "neo@example.com", password: "password1" }), /invalid account/);
  await assert.rejects(() => registerAccount({ email: "ada@example.com", password: "password1" }), /请填写有效的手机号|用户名不合法/);
  const created = await registerAccount({ username: "ada", phone: "13900139000", password: "password1" });
  assert.equal(created.user.email, "ada");
  assert.equal(created.user.phone, "13900139000");
  assert.equal(created.pending, true);
  assert.equal(created.user.status, "pending");
  assert.equal(created.user.creditFen, 500);
  await assert.rejects(() => loginAccount({ email: "13900139000", password: "password1" }), /账号待管理员审核/);
  await approveAccount(created.user.id);
  const byPhone = await loginAccount({ email: "13900139000", password: "password1" });
  assert.equal(byPhone.user.email, "ada");
  await assert.rejects(
    () => registerAccount({ username: "ada2", phone: "13900139000", password: "password1" }),
    /手机号已注册/,
  );
});

test("ensureBootstrapAccount now seeds admin instead of a second email", async () => {
  const first = await ensureBootstrapAccount();
  assert.equal(first?.email, "admin");
  const again = await ensureBootstrapAccount();
  assert.equal(again?.email, "admin");
});

test("ensureDefaultAdmin resets a drifted admin password back to 123456", async () => {
  await ensureDefaultAdmin();
  const store = getAccountStore();
  const existing = await store.findUserByEmail("admin");
  assert.ok(existing);
  await store.updateUserPassword(existing.id, hashPassword("old-password"));
  await assert.rejects(() => loginAccount({ email: "admin", password: "old-password" }), /invalid account/);
  const session = await loginAccount({ email: "admin", password: "123456" });
  assert.equal(session.user.email, "admin");
});

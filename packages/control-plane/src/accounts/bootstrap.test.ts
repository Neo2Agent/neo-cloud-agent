import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-bootstrap-"));
process.env.BOOTSTRAP_EMAIL = "neo@example.com";
process.env.BOOTSTRAP_PASSWORD = "password1";
delete process.env.DATABASE_URL;

const {
  bootstrapEmail,
  DEFAULT_ADMIN_LOGIN,
  ensureBootstrapAccount,
  ensureDefaultAdmin,
  loginAccount,
  loginBootstrapAccount,
} = await import("./accounts.js");

test("ensureBootstrapAccount creates the env user once", async () => {
  const first = await ensureBootstrapAccount();
  assert.equal(first?.email, "neo@example.com");
  const again = await ensureBootstrapAccount();
  assert.equal(again?.email, "neo@example.com");
  const session = await loginAccount({ email: "neo@example.com", password: "password1" });
  assert.match(session.token, /^neo_sess_/);
});

test("loginBootstrapAccount signs in without a client password", async () => {
  const session = await loginBootstrapAccount();
  assert.equal(session.user.email, "neo@example.com");
  assert.match(session.token, /^neo_sess_/);
  assert.equal(bootstrapEmail(), "neo@example.com");
});

test("default admin admin/123456 can log in", async () => {
  const previousEmail = process.env.BOOTSTRAP_EMAIL;
  const previousPassword = process.env.BOOTSTRAP_PASSWORD;
  delete process.env.BOOTSTRAP_EMAIL;
  delete process.env.BOOTSTRAP_PASSWORD;
  try {
    const admin = await ensureDefaultAdmin();
    assert.equal(admin?.email, DEFAULT_ADMIN_LOGIN);
    assert.equal(bootstrapEmail(), "admin");
    const session = await loginAccount({ email: "Admin", password: "123456" });
    assert.equal(session.user.email, "admin");
    const auto = await loginBootstrapAccount();
    assert.equal(auto.user.email, "admin");
  } finally {
    process.env.BOOTSTRAP_EMAIL = previousEmail;
    process.env.BOOTSTRAP_PASSWORD = previousPassword;
  }
});

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

const { bootstrapEmail, ensureBootstrapAccount, loginAccount, loginBootstrapAccount } = await import("./accounts.js");

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

test("ensureBootstrapAccount no-ops without env", async () => {
  const previousEmail = process.env.BOOTSTRAP_EMAIL;
  const previousPassword = process.env.BOOTSTRAP_PASSWORD;
  delete process.env.BOOTSTRAP_EMAIL;
  delete process.env.BOOTSTRAP_PASSWORD;
  try {
    assert.equal(await ensureBootstrapAccount(), null);
  } finally {
    process.env.BOOTSTRAP_EMAIL = previousEmail;
    process.env.BOOTSTRAP_PASSWORD = previousPassword;
  }
});

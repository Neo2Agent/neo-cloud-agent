import assert from "node:assert/strict";
import test from "node:test";

const previousName = process.env.SESSION_COOKIE_NAME;
const previousPath = process.env.SESSION_COOKIE_PATH;
delete process.env.SESSION_COOKIE_NAME;
delete process.env.SESSION_COOKIE_PATH;

const { SESSION_COOKIE, clearSessionCookieHeader, sessionCookieHeader, sessionCookieName, sessionCookiePath } =
  await import("./accounts.js");

test("session cookie defaults stay on Path=/; admin can isolate name and path", () => {
  assert.equal(sessionCookieName(), SESSION_COOKIE);
  assert.equal(sessionCookiePath(), "/");
  assert.match(sessionCookieHeader("tok"), /^neo_session=tok; Path=\/; HttpOnly/);
  assert.match(clearSessionCookieHeader(), /^neo_session=; Path=\/; HttpOnly/);

  process.env.SESSION_COOKIE_NAME = "neo_admin_session";
  process.env.SESSION_COOKIE_PATH = "admin";
  try {
    assert.equal(sessionCookieName(), "neo_admin_session");
    assert.equal(sessionCookiePath(), "/admin");
    assert.match(sessionCookieHeader("tok"), /^neo_admin_session=tok; Path=\/admin; HttpOnly/);
    assert.match(clearSessionCookieHeader(), /^neo_admin_session=; Path=\/admin; HttpOnly/);
  } finally {
    if (previousName === undefined) delete process.env.SESSION_COOKIE_NAME;
    else process.env.SESSION_COOKIE_NAME = previousName;
    if (previousPath === undefined) delete process.env.SESSION_COOKIE_PATH;
    else process.env.SESSION_COOKIE_PATH = previousPath;
  }
});

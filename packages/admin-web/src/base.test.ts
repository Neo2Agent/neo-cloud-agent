import assert from "node:assert/strict";
import test from "node:test";
import { joinAdminApiPath } from "./base.js";

test("admin API paths stay at /v1 locally and under /admin in production", () => {
  assert.equal(joinAdminApiPath("/", "/v1/auth/login"), "/v1/auth/login");
  assert.equal(joinAdminApiPath("/admin/", "/v1/me"), "/admin/v1/me");
  assert.equal(joinAdminApiPath("/admin", "v1/admin/overview"), "/admin/v1/admin/overview");
});

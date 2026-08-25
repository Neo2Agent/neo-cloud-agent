import assert from "node:assert/strict";
import test from "node:test";
import { apiPrefix, apiUrl } from "./api.js";

test("apiPrefix stays empty on the Vite / admin-api root", () => {
  assert.equal(apiPrefix("/"), "");
  assert.equal(apiPrefix("/v1/admin/overview"), "");
});

test("apiPrefix keeps /admin when Caddy mounts the console there", () => {
  assert.equal(apiPrefix("/admin"), "/admin");
  assert.equal(apiPrefix("/admin/"), "/admin");
  assert.equal(apiUrl("/v1/admin/overview", "/admin/"), "/admin/v1/admin/overview");
  assert.equal(apiUrl("/v1/auth/login", "/"), "/v1/auth/login");
});

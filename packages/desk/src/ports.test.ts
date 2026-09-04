import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DESK_UI_PORT,
  DEFAULT_PRODUCTION_CONTROL_PLANE,
  LEGACY_PRODUCTION_CONTROL_PLANE,
  controlPlaneOrigin,
  deskClientOrigin,
  deskRendererUrl,
  isDeskApiProxyPath,
  isLoopbackOrigin,
  productionControlPlaneCandidates,
} from "./ports.js";

test("the desk UI port collides with neither the web UI nor the control plane", () => {
  assert.equal(DEFAULT_DESK_UI_PORT, 5174);
  assert.notEqual(DEFAULT_DESK_UI_PORT, 5173);
  assert.notEqual(DEFAULT_DESK_UI_PORT, 8080);
  assert.equal(deskRendererUrl({}), "");
  assert.equal(deskRendererUrl({ NEO_DESK_PORT: "8082" }), "");
  assert.equal(deskRendererUrl({ NEO_DESK_URL: "http://127.0.0.1:8099/" }), "http://127.0.0.1:8099");
  assert.equal(controlPlaneOrigin({}), "http://127.0.0.1:8080");
});

test("production Desk launch ignores a local CONTROL_PLANE_URL from .env", () => {
  assert.equal(isLoopbackOrigin("http://127.0.0.1:8080"), true);
  assert.equal(isLoopbackOrigin("http://62.234.211.200"), false);
  assert.equal(DEFAULT_PRODUCTION_CONTROL_PLANE, "https://neorun.cloud");
  assert.equal(LEGACY_PRODUCTION_CONTROL_PLANE, "http://62.234.211.200");
  assert.equal(
    deskClientOrigin({ CONTROL_PLANE_URL: "http://127.0.0.1:8080" }, { production: true }),
    DEFAULT_PRODUCTION_CONTROL_PLANE,
  );
  assert.equal(
    deskClientOrigin({ NEO_CONTROL_PLANE_URL: "http://example.test:8080", CONTROL_PLANE_URL: "http://127.0.0.1:8080" }, { production: true }),
    "http://example.test:8080",
  );
  assert.equal(
    deskClientOrigin({ NEO_CONTROL_PLANE_URL: "http://127.0.0.1:8080" }, { production: true }),
    DEFAULT_PRODUCTION_CONTROL_PLANE,
  );
  assert.equal(controlPlaneOrigin({ NEO_DESK_PACKAGED: "1", CONTROL_PLANE_URL: "http://127.0.0.1:8080" }), DEFAULT_PRODUCTION_CONTROL_PLANE);
  assert.deepEqual(productionControlPlaneCandidates(), [
    DEFAULT_PRODUCTION_CONTROL_PLANE,
    LEGACY_PRODUCTION_CONTROL_PLANE,
  ]);
  assert.equal(isDeskApiProxyPath("/v1/auth/login"), true);
  assert.equal(isDeskApiProxyPath("/health"), true);
  assert.equal(isDeskApiProxyPath("/index.html"), false);
});

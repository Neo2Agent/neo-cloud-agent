import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DESK_PORT,
  DEFAULT_DESK_UI_PORT,
  DEFAULT_PRODUCTION_CONTROL_PLANE,
  DEFAULT_WEB_UI_PORT,
  controlPlaneOrigin,
  deskClientOrigin,
  deskPreviewListenPort,
  deskRendererUrl,
  isLoopbackOrigin,
} from "./ports.js";

test("web and desk UIs use different ports from the control plane", () => {
  assert.equal(DEFAULT_WEB_UI_PORT, 5173);
  assert.equal(DEFAULT_DESK_UI_PORT, 5174);
  assert.notEqual(DEFAULT_WEB_UI_PORT, DEFAULT_DESK_UI_PORT);
  assert.notEqual(DEFAULT_DESK_UI_PORT, 8080);
  assert.equal(DEFAULT_DESK_PORT, 8082);
  assert.notEqual(DEFAULT_DESK_PORT, 8080);
  assert.equal(deskPreviewListenPort({}), 8082);
  assert.equal(deskRendererUrl({}), "");
  assert.equal(deskRendererUrl({ NEO_DESK_PORT: "8082" }), "http://127.0.0.1:8082");
  assert.equal(deskRendererUrl({ NEO_DESK_URL: "http://127.0.0.1:8099/" }), "http://127.0.0.1:8099");
  assert.equal(controlPlaneOrigin({}), "http://127.0.0.1:8080");
});

test("production Desk launch ignores a local CONTROL_PLANE_URL from .env", () => {
  assert.equal(isLoopbackOrigin("http://127.0.0.1:8080"), true);
  assert.equal(isLoopbackOrigin("http://62.234.211.200"), false);
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
});

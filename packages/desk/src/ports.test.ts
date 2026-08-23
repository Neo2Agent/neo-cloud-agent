import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DESK_PORT, DEFAULT_DESK_UI_PORT, DEFAULT_WEB_UI_PORT, controlPlaneOrigin, deskPreviewListenPort, deskRendererUrl } from "./ports.js";

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

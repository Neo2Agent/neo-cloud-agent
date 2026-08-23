import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DESK_PORT, controlPlaneOrigin, deskPreviewListenPort, deskRendererUrl } from "./ports.js";

test("desk preview defaults to 8082, not the web 8080 port", () => {
  assert.equal(DEFAULT_DESK_PORT, 8082);
  assert.notEqual(DEFAULT_DESK_PORT, 8080);
  assert.equal(deskPreviewListenPort({}), 8082);
  assert.equal(deskRendererUrl({}), "");
  assert.equal(deskRendererUrl({ NEO_DESK_PORT: "8082" }), "http://127.0.0.1:8082");
  assert.equal(deskRendererUrl({ NEO_DESK_URL: "http://127.0.0.1:8099/" }), "http://127.0.0.1:8099");
  assert.equal(controlPlaneOrigin({}), "http://127.0.0.1:8080");
});

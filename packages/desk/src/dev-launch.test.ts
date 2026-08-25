import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PRODUCTION_CONTROL_PLANE } from "./ports.js";
import { resolveDeskDevLaunch } from "./dev-launch.js";

test("dev:desk is 预发 and starts the local backend", () => {
  const launch = resolveDeskDevLaunch({ NEO_DESK_UI_PORT: "5174" }, ["tsx", "scripts/dev.ts"]);
  assert.equal(launch.production, false);
  assert.equal(launch.label, "预发");
  assert.equal(launch.apiBase, "http://127.0.0.1:8080");
  assert.equal(launch.uiUrl, "http://127.0.0.1:5174");
  assert.equal(launch.startLocalBackend, true);
});

test("dev:desk:prod is 生产 and uses the remote control plane", () => {
  const launch = resolveDeskDevLaunch(
    { CONTROL_PLANE_URL: "http://127.0.0.1:8080", NEO_DESK_UI_PORT: "5174" },
    ["tsx", "scripts/dev.ts", "--prod"],
  );
  assert.equal(launch.production, true);
  assert.equal(launch.label, "生产");
  assert.equal(launch.apiBase, DEFAULT_PRODUCTION_CONTROL_PLANE);
  assert.equal(launch.startLocalBackend, false);
});

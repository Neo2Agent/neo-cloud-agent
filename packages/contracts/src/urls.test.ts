import assert from "node:assert/strict";
import test from "node:test";
import { deskToolsProxyUrl, isDeskToolsProxyUrl, isLoopbackHttpUrl } from "./urls.js";

test("isLoopbackHttpUrl only accepts local hosts", () => {
  assert.equal(isLoopbackHttpUrl("http://127.0.0.1:8080"), true);
  assert.equal(isLoopbackHttpUrl("http://localhost:8080/v1"), true);
  assert.equal(isLoopbackHttpUrl("https://neorun.cloud"), false);
  assert.equal(isLoopbackHttpUrl("not a url"), false);
});

test("deskToolsProxyUrl stays on the control plane", () => {
  assert.equal(
    deskToolsProxyUrl("https://neorun.cloud/", "desk_1", "run-9"),
    "https://neorun.cloud/v1/desks/desk_1/tools/run-9",
  );
  assert.equal(isDeskToolsProxyUrl("https://neorun.cloud/v1/desks/desk_1/tools/run-9"), true);
  assert.equal(isDeskToolsProxyUrl("http://127.0.0.1:8082/internal/tools/run-9"), false);
});

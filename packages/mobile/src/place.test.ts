import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_TARGET, DEFAULT_API_URL, runPlace, runPlaceLabel } from "./place.js";

test("native default API is the production host over HTTP", () => {
  assert.equal(DEFAULT_API_URL, "http://62.234.211.200");
});

test("new mobile runs always use the cloud target", () => {
  assert.deepEqual(CLOUD_TARGET, { loop: "cloud", tools: "cloud" });
});

test("runPlace marks only Desk Remote Control as remote", () => {
  assert.equal(runPlace({ executionTarget: CLOUD_TARGET }), "cloud");
  assert.equal(runPlace({ executionTarget: { loop: "desk", tools: "desk" } }), "cloud");
  assert.equal(
    runPlace({ executionTarget: { loop: "desk", tools: "desk", deskId: "desk_1", remoteControl: true } }),
    "remote",
  );
  assert.equal(runPlaceLabel({ executionTarget: CLOUD_TARGET }), "cloud");
});

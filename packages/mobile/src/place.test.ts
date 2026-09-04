import assert from "node:assert/strict";
import test from "node:test";
import { canonicalApiUrl, CLOUD_TARGET, DEFAULT_API_URL, runPlace, runPlaceLabel } from "./place.js";

test("native default API is the production HTTPS origin", () => {
  assert.equal(DEFAULT_API_URL, "https://neorun.cloud");
  assert.equal(canonicalApiUrl(""), DEFAULT_API_URL);
  assert.equal(canonicalApiUrl("http://62.234.211.200/"), DEFAULT_API_URL);
  assert.equal(canonicalApiUrl("http://neorun.cloud"), DEFAULT_API_URL);
  assert.equal(canonicalApiUrl("http://192.168.1.8:8080"), "http://192.168.1.8:8080");
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

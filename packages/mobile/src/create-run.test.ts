import assert from "node:assert/strict";
import test from "node:test";
import { cloudRunRequest } from "./create-run.js";
import { CLOUD_TARGET } from "./place.js";

test("cloudRunRequest always posts the cloud target", () => {
  const body = cloudRunRequest({ prompt: "hello", source: "ios", envId: "env_1", model: "deepseek-v4-flash", projectId: "p1" });
  assert.deepEqual(body.target, CLOUD_TARGET);
  assert.equal(body.source, "ios");
  assert.equal(body.projectId, "p1");
  assert.deepEqual(body.repoUrls, []);
});

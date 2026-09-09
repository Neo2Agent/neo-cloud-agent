import assert from "node:assert/strict";
import test from "node:test";
import { clearStepCache, rememberSuccessfulStep, replaySuccessfulStep } from "./step-cache.js";

test("step cache replays a successful non-stream completion", () => {
  clearStepCache();
  rememberSuccessfulStep("step-1", {
    status: 200,
    headers: { "content-type": "application/json" },
    stream: false,
    payload: JSON.stringify({ id: "cmpl-1", cached: true }),
  });
  const hit = replaySuccessfulStep("step-1");
  assert.equal(hit?.status, 200);
  assert.match(hit?.payload ?? "", /cmpl-1/);
  rememberSuccessfulStep("step-fail", {
    status: 502,
    headers: {},
    stream: false,
    payload: "{}",
  });
  assert.equal(replaySuccessfulStep("step-fail"), undefined);
});

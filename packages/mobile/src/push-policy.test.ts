import assert from "node:assert/strict";
import test from "node:test";
import { runIdFromNotificationData, shouldShowLocalPushBanner } from "./push-policy.js";

test("runIdFromNotificationData reads the push payload", () => {
  assert.equal(runIdFromNotificationData({ runId: "r1" }), "r1");
  assert.equal(runIdFromNotificationData({}), null);
});

test("suppresses a local banner when the open run already has live SSE", () => {
  assert.equal(
    shouldShowLocalPushBanner({
      appInForeground: true,
      liveSse: true,
      notifyingRunId: "r1",
      openRunId: "r1",
    }),
    false,
  );
});

test("still banners a different run or when SSE is down", () => {
  assert.equal(
    shouldShowLocalPushBanner({
      appInForeground: true,
      liveSse: true,
      notifyingRunId: "r2",
      openRunId: "r1",
    }),
    true,
  );
  assert.equal(shouldShowLocalPushBanner({ appInForeground: true, liveSse: false, notifyingRunId: "r1", openRunId: "r1" }), true);
  assert.equal(shouldShowLocalPushBanner({ appInForeground: false, liveSse: true, notifyingRunId: "r1", openRunId: "r1" }), true);
});

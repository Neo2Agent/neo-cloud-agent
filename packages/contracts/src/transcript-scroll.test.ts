import assert from "node:assert/strict";
import test from "node:test";
import { shouldFollowTranscript } from "./display.js";

test("scrolling up to reread does not follow the transcript back to the bottom", () => {
  assert.equal(
    shouldFollowTranscript({ scrollHeight: 2000, scrollTop: 0, clientHeight: 600 }),
    false,
  );
  assert.equal(
    shouldFollowTranscript({ scrollHeight: 2000, scrollTop: 1200, clientHeight: 600 }),
    false,
  );
});

test("a reader already at the bottom keeps following new tokens", () => {
  assert.equal(
    shouldFollowTranscript({ scrollHeight: 2000, scrollTop: 1400, clientHeight: 600 }),
    true,
  );
  assert.equal(
    shouldFollowTranscript({ scrollHeight: 800, scrollTop: 0, clientHeight: 800 }),
    true,
  );
});

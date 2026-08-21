import assert from "node:assert/strict";
import test from "node:test";
import { mintRunToken, verifyRunToken } from "./jwt.js";

const secret = "test-secret";

function claims(expOffsetSec = 60) {
  return {
    sub: "user_1",
    runId: "run_1",
    orgId: "org_1",
    model: "neo/sonnet",
    exp: Math.floor(Date.now() / 1000) + expOffsetSec,
    jti: "jti_1",
  };
}

test("mint and verify a run JWT", () => {
  const token = mintRunToken(secret, claims());
  const parsed = verifyRunToken(secret, token);
  assert.equal(parsed.iss, "neo-llm-gateway");
  assert.equal(parsed.runId, "run_1");
  assert.equal(parsed.model, "neo/sonnet");
});

test("rejects a token signed with another secret", () => {
  const token = mintRunToken(secret, claims());
  assert.throws(() => verifyRunToken("other", token), /signature/);
});

test("rejects an expired token", () => {
  const token = mintRunToken(secret, claims(-10));
  assert.throws(() => verifyRunToken(secret, token), /expired/);
});

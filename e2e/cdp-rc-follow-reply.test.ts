import assert from "node:assert/strict";
import test from "node:test";
import { MOCK_GATEWAY_TEXT, assertUniqueMockReplies, countNeedle } from "./rc-follow-assert.ts";

test("countNeedle finds each copy of the mock sentence", () => {
  assert.equal(countNeedle(MOCK_GATEWAY_TEXT, MOCK_GATEWAY_TEXT), 1);
  assert.equal(countNeedle(`${MOCK_GATEWAY_TEXT}${MOCK_GATEWAY_TEXT}`, MOCK_GATEWAY_TEXT), 2);
});

test("two turns with one mock each pass; one glued bubble fails", () => {
  assertUniqueMockReplies(
    {
      href: "",
      assistantTexts: [MOCK_GATEWAY_TEXT, MOCK_GATEWAY_TEXT],
      setupTexts: [],
      userTexts: ["first", "follow"],
      bodyText: `first ${MOCK_GATEWAY_TEXT} follow ${MOCK_GATEWAY_TEXT}`,
    },
    "ok",
  );
  assert.throws(
    () =>
      assertUniqueMockReplies(
        {
          href: "",
          assistantTexts: [`${MOCK_GATEWAY_TEXT}${MOCK_GATEWAY_TEXT}`],
          setupTexts: [],
          userTexts: ["first", "follow"],
          bodyText: `first follow ${MOCK_GATEWAY_TEXT}${MOCK_GATEWAY_TEXT}`,
        },
        "bug",
      ),
    /twice|compacted/,
  );
});

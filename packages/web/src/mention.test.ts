import assert from "node:assert/strict";
import test from "node:test";
import { applyMention, filterMentions, mentionTrigger } from "./mention.js";

test("mentionTrigger only fires after a lone @", () => {
  assert.equal(mentionTrigger("hello@x"), null);
  assert.deepEqual(mentionTrigger("看 @审"), { trigger: "@", query: "审" });
});

test("applyMention replaces the active token", () => {
  assert.equal(applyMention("请 @审", { kind: "expert", id: "e1", label: "审查", insert: "@专家 审查" }), "请 @专家 审查 ");
});

test("filterMentions matches label", () => {
  const items = [
    { kind: "expert" as const, id: "1", label: "审查", insert: "@专家 审查" },
    { kind: "plugin" as const, id: "2", label: "PR 审查", insert: "@技能 PR 审查" },
  ];
  assert.equal(filterMentions(items, "PR")[0]?.id, "2");
});

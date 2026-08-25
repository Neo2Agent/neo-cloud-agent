import assert from "node:assert/strict";
import test from "node:test";
import { matchAutomationCommand } from "./automation-command.js";

const items = [
  { id: "auto_reuse", name: "复用检查" },
  { id: "auto_daily", name: "Daily Review" },
];

test("matchAutomationCommand accepts /自动化 name and /name", () => {
  assert.equal(matchAutomationCommand("/自动化 复用检查", items)?.id, "auto_reuse");
  assert.equal(matchAutomationCommand("  /复用检查  ", items)?.id, "auto_reuse");
  assert.equal(matchAutomationCommand("/auto_daily", items)?.id, "auto_daily");
  assert.equal(matchAutomationCommand("/daily review", items)?.id, "auto_daily");
});

test("matchAutomationCommand ignores empty or unknown slashes", () => {
  assert.equal(matchAutomationCommand("/", items), undefined);
  assert.equal(matchAutomationCommand("/自动化", items), undefined);
  assert.equal(matchAutomationCommand("复用检查", items), undefined);
  assert.equal(matchAutomationCommand("/没有这个", items), undefined);
});

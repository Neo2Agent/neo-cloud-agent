import assert from "node:assert/strict";
import test from "node:test";
import { INSPECTOR_TABS, inspectorTabs } from "./inspector-tabs.ts";

test("inspector tabs are Git / 终端 / 文件 across Desk, Web, and Mobile", () => {
  assert.deepEqual(
    INSPECTOR_TABS.map((item) => item.label),
    ["Git", "终端", "文件"],
  );
  assert.deepEqual(
    inspectorTabs(true).map((item) => item.id),
    ["git", "terminal", "files"],
  );
  assert.deepEqual(
    inspectorTabs(false).map((item) => item.id),
    ["terminal", "files"],
  );
});

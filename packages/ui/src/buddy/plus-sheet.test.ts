import assert from "node:assert/strict";
import test from "node:test";
import { BUDDY_PLUS_ROWS } from "./plus-sheet.js";

test("plus sheet lists settings as a row so the composer bar can drop the gear", () => {
  assert.deepEqual(
    BUDDY_PLUS_ROWS.map((item) => item.id),
    ["settings", "new", "pr"],
  );
  assert.equal(BUDDY_PLUS_ROWS[0]?.label, "设置");
  assert.equal(BUDDY_PLUS_ROWS[0]?.icon, "gear");
});

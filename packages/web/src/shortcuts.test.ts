import assert from "node:assert/strict";
import test from "node:test";
import { cycle, shortcutAction } from "./shortcuts.js";

test("shortcutAction maps Cursor-aligned keys", () => {
  assert.equal(shortcutAction({ key: "t", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, "darwin"), "new-chat");
  assert.equal(shortcutAction({ key: "[", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, "other"), "prev-run");
  assert.equal(shortcutAction({ key: "Enter", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }), "queue");
  assert.equal(shortcutAction({ key: "Tab", ctrlKey: false, metaKey: false, shiftKey: true, altKey: false }), "cycle-mode");
  assert.equal(shortcutAction({ key: "/", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, "darwin"), "cycle-model");
  assert.equal(shortcutAction({ key: "w", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, "darwin"), "close");
  assert.equal(shortcutAction({ key: ".", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, "other"), "mode-menu");
});

test("cycle wraps around", () => {
  assert.equal(cycle(["a", "b", "c"], "b"), "c");
  assert.equal(cycle(["a", "b", "c"], "c"), "a");
});

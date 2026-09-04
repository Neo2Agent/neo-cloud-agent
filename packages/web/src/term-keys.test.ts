import assert from "node:assert/strict";
import test from "node:test";
import { nextHistoryIndex, termKeyAction } from "./term-keys.js";

test("Enter submits, composition does not", () => {
  assert.equal(termKeyAction({ key: "Enter" }), "submit");
  assert.equal(termKeyAction({ key: "Enter", composing: true }), "ignore");
});

test("Ctrl/Cmd+C interrupts and Ctrl/Cmd+L clears the view", () => {
  assert.equal(termKeyAction({ key: "c", ctrlKey: true }), "interrupt");
  assert.equal(termKeyAction({ key: "c", metaKey: true }), "interrupt");
  assert.equal(termKeyAction({ key: "l", ctrlKey: true }), "clear");
});

test("arrows walk command history", () => {
  assert.equal(termKeyAction({ key: "ArrowUp" }), "history-prev");
  assert.equal(termKeyAction({ key: "ArrowDown" }), "history-next");
  assert.equal(nextHistoryIndex("history-prev", -1, 3), 2);
  assert.equal(nextHistoryIndex("history-prev", 2, 3), 1);
  assert.equal(nextHistoryIndex("history-next", 1, 3), 2);
  assert.equal(nextHistoryIndex("history-next", 2, 3), -1);
  assert.equal(nextHistoryIndex("history-prev", -1, 0), -1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { nextHistoryIndex, termKeyAction, termKeyBytes } from "./term-keys.js";

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

test("PTY key map sends Tab, Enter, arrows and backspace", () => {
  assert.equal(termKeyBytes({ key: "Tab" }), "\t");
  assert.equal(termKeyBytes({ key: "Enter" }), "\r");
  assert.equal(termKeyBytes({ key: "Backspace" }), "\x7f");
  assert.equal(termKeyBytes({ key: "ArrowUp" }), "\x1b[A");
  assert.equal(termKeyBytes({ key: "l" }), "l");
  assert.equal(termKeyBytes({ key: "c", ctrlKey: true }), "\x03");
  assert.equal(termKeyBytes({ key: "Enter", composing: true }), null);
  assert.equal(termKeyBytes({ key: "F1" }), null);
});

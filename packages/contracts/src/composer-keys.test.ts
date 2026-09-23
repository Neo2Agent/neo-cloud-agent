import assert from "node:assert/strict";
import test from "node:test";
import { composerKeyAction, followUpDelivery, isImeComposing } from "./composer-keys.js";

const idle = { busy: false };
const busy = { busy: true };

test("an Enter that confirms an IME candidate does nothing", () => {
  assert.equal(isImeComposing({ isComposing: true }), true);
  assert.equal(isImeComposing({ keyCode: 229 }), true);
  assert.equal(isImeComposing({ isComposing: false, keyCode: 13 }), false);
  assert.equal(composerKeyAction({ key: "Enter", isComposing: true }, idle), null);
  assert.equal(composerKeyAction({ key: "Enter", keyCode: 229 }, busy), null);
  assert.equal(composerKeyAction({ key: "Enter", ctrlKey: true, isComposing: true }, busy), null);
});

test("idle: Enter and Mod+Enter send, Shift+Enter is a newline", () => {
  assert.equal(composerKeyAction({ key: "Enter" }, idle), "send");
  assert.equal(composerKeyAction({ key: "Enter", metaKey: true }, idle), "send");
  assert.equal(composerKeyAction({ key: "Enter", ctrlKey: true }, idle), "send");
  assert.equal(composerKeyAction({ key: "Enter", shiftKey: true }, idle), null);
  assert.equal(composerKeyAction({ key: "a" }, idle), null);
});

test("running: Enter queues after the turn, Mod+Enter steers now", () => {
  assert.equal(composerKeyAction({ key: "Enter" }, busy), "queue");
  assert.equal(composerKeyAction({ key: "Enter", ctrlKey: true }, busy), "steer");
  assert.equal(composerKeyAction({ key: "Enter", metaKey: true }, busy), "steer");
  assert.equal(followUpDelivery("queue"), "follow_up");
  assert.equal(followUpDelivery("steer"), "steer");
  assert.equal(followUpDelivery("send"), undefined);
});

test("on a phone plain Enter is a newline; Mod+Enter still acts", () => {
  assert.equal(composerKeyAction({ key: "Enter" }, { busy: false, narrow: true }), null);
  assert.equal(composerKeyAction({ key: "Enter" }, { busy: true, narrow: true }), null);
  assert.equal(composerKeyAction({ key: "Enter", ctrlKey: true }, { busy: true, narrow: true }), "steer");
});

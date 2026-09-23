import assert from "node:assert/strict";
import test from "node:test";
import {
  applyVisualViewport,
  closeMobileSidebar,
  isImeComposing,
  isNarrowViewport,
  shouldQueueOnCtrlEnter,
  shouldSendOnEnter,
} from "./viewport.js";

test("shouldSendOnEnter is off on a phone-sized viewport", () => {
  assert.equal(shouldSendOnEnter({ key: "Enter", shiftKey: false }), true);
  assert.equal(shouldSendOnEnter({ key: "Enter", shiftKey: false }, { narrow: true }), false);
  assert.equal(shouldSendOnEnter({ key: "Enter", shiftKey: true }, { narrow: false }), false);
  assert.equal(shouldSendOnEnter({ key: "a", shiftKey: false }, { narrow: false }), false);
  assert.equal(shouldSendOnEnter({ key: "Enter", shiftKey: false, ctrlKey: true }), false);
  assert.equal(shouldQueueOnCtrlEnter({ key: "Enter", ctrlKey: true }), true);
});

test("Enter that confirms an IME candidate never sends or queues", () => {
  assert.equal(isImeComposing({ isComposing: true }), true);
  assert.equal(isImeComposing({ keyCode: 229 }), true);
  assert.equal(isImeComposing({ isComposing: false, keyCode: 13 }), false);
  assert.equal(shouldSendOnEnter({ key: "Enter", shiftKey: false, isComposing: true }), false);
  assert.equal(shouldSendOnEnter({ key: "Enter", shiftKey: false, keyCode: 229 }), false);
  assert.equal(shouldSendOnEnter({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 }), true);
  assert.equal(shouldQueueOnCtrlEnter({ key: "Enter", ctrlKey: true, isComposing: true }), false);
});

test("isNarrowViewport follows the 860px chat breakpoint", () => {
  assert.equal(isNarrowViewport({ innerWidth: 390 }), true);
  assert.equal(isNarrowViewport({ innerWidth: 1280 }), false);
  assert.equal(
    isNarrowViewport({
      innerWidth: 1280,
      matchMedia: (query) => ({ matches: query.includes("860") && false }) as MediaQueryList,
    }),
    false,
  );
});

test("applyVisualViewport writes CSS custom properties for the on-screen keyboard", () => {
  const props = new Map<string, string>();
  applyVisualViewport(
    {
      setProperty: (name, value) => {
        props.set(name, value);
      },
    },
    { height: 512.4, offsetTop: 88.2 },
  );
  assert.equal(props.get("--app-height"), "512px");
  assert.equal(props.get("--app-offset-top"), "88px");
});

test("closeMobileSidebar only persists closed on a phone-sized viewport", () => {
  const store = new Map<string, string>([["neo.sidebar", "1"]]);
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  assert.equal(
    closeMobileSidebar({
      innerWidth: 1280,
      localStorage: storage as Storage,
    }),
    false,
  );
  assert.equal(store.get("neo.sidebar"), "1");
  assert.equal(
    closeMobileSidebar({
      innerWidth: 390,
      localStorage: storage as Storage,
    }),
    true,
  );
  assert.equal(store.get("neo.sidebar"), "0");
});

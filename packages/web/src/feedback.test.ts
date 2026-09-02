import assert from "node:assert/strict";
import test from "node:test";
import { subscribeToast, toast } from "./feedback.js";

test("toast notifies subscribers with kind", () => {
  const seen: Array<{ text: string; kind: string }> = [];
  const stop = subscribeToast((item) => seen.push({ text: item.text, kind: item.kind }));
  toast("已保存");
  toast("失败", "err");
  stop();
  toast("ignored");
  assert.deepEqual(seen, [
    { text: "已保存", kind: "ok" },
    { text: "失败", kind: "err" },
  ]);
});

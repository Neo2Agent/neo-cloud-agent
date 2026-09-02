import assert from "node:assert/strict";
import test from "node:test";
import { allocateWidths, hitTestBar, layoutContextBar } from "./context-bar.js";

test("allocateWidths never invents extra pixels", () => {
  const widths = allocateWidths([713, 108, 164, 1289, 1051, 34], 332, 2);
  const sum = widths.reduce((acc, value) => acc + value, 0);
  assert.ok(Math.abs(sum - 332) < 1e-6);
  assert.ok(widths.every((value) => value >= 2));
  assert.ok(widths[3] > widths[0], "the largest share stays the widest");
  assert.ok(widths[5] < widths[3], "conversation stays thinner than tools");
});

test("a tiny fill occupies a sliver instead of stretching every bucket", () => {
  const layout = layoutContextBar({
    width: 332,
    tokens: 3359,
    contextWindow: 1_000_000,
    buckets: [
      { id: "system", label: "系统提示", tokens: 713 },
      { id: "rules", label: "规则", tokens: 108 },
      { id: "skills", label: "技能目录", tokens: 164 },
      { id: "tools", label: "内置工具", tokens: 1289 },
      { id: "cloudTools", label: "云端工具", tokens: 1051 },
      { id: "conversation", label: "对话", tokens: 34 },
    ],
  });
  assert.ok(layout.used < 20, `used region should stay a sliver, got ${layout.used}`);
  assert.ok(layout.used >= 10);
  const span = layout.slices.reduce((acc, slice) => acc + slice.width, 0);
  assert.ok(Math.abs(span - layout.used) < 1e-6);
  const tools = layout.slices.find((slice) => slice.id === "tools");
  const conversation = layout.slices.find((slice) => slice.id === "conversation");
  assert.ok(tools && conversation);
  assert.ok(tools.width > conversation.width);
});

test("without a window the used region is the full bar", () => {
  const layout = layoutContextBar({
    width: 200,
    tokens: 100,
    contextWindow: null,
    buckets: [
      { id: "system", label: "系统提示", tokens: 75 },
      { id: "tools", label: "内置工具", tokens: 25 },
    ],
  });
  assert.equal(layout.used, 200);
  assert.ok(Math.abs((layout.slices[0]?.width ?? 0) - 150) < 1e-6);
});

test("child slices sit inside the parent and add up to it", () => {
  const layout = layoutContextBar({
    width: 200,
    tokens: 100,
    contextWindow: null,
    buckets: [
      {
        id: "tools",
        label: "内置工具",
        tokens: 100,
        children: [
          { id: "read", label: "read", tokens: 70 },
          { id: "bash", label: "bash", tokens: 30 },
        ],
      },
    ],
  });
  const kids = layout.children.tools ?? [];
  assert.equal(kids.length, 2);
  assert.ok(Math.abs(kids.reduce((acc, slice) => acc + slice.width, 0) - 200) < 1e-6);
  assert.ok((kids[0]?.width ?? 0) > (kids[1]?.width ?? 0));
  const hit = hitTestBar(layout, 10, true);
  assert.equal(hit?.child?.id, "read");
});

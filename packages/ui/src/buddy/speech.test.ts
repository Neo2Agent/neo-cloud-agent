import assert from "node:assert/strict";
import test from "node:test";
import { holdPadLabel, modelShortLabel } from "./speech.js";

test("modelShortLabel maps DeepSeek ids", () => {
  assert.equal(modelShortLabel("deepseek-flash"), "Flash");
  assert.equal(modelShortLabel("deepseek-v4-pro"), "Flash");
  assert.equal(modelShortLabel("step-5-preview"), "Step 5");
});

test("holdPadLabel is click-to-talk when the engine exists", () => {
  assert.equal(holdPadLabel({ supported: true, holding: false }), "点一下开始说话");
  assert.equal(holdPadLabel({ supported: true, holding: true }), "正在听…再点一下完成");
  assert.equal(holdPadLabel({ supported: true, holding: false, finishing: true }), "正在转文字…");
  assert.equal(holdPadLabel({ supported: false, holding: false, followUp: true }), "继续说一句…");
  assert.equal(holdPadLabel({ supported: true, holding: false, fileFallback: true }), "选录音文件");
});

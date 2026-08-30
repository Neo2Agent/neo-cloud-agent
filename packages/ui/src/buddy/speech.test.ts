import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPointer,
  collectSpeechTranscript,
  holdPadLabel,
  mergeSpokenText,
  modelShortLabel,
  startSpeechRecognition,
  type SpeechEngine,
} from "./speech.js";

test("classifyPointer treats a short press as tap", () => {
  assert.equal(classifyPointer(80), "tap");
  assert.equal(classifyPointer(280), "hold");
});

test("mergeSpokenText appends without doubling spaces", () => {
  assert.equal(mergeSpokenText("", "  加 README  "), "加 README");
  assert.equal(mergeSpokenText("先看 CI", "再开 PR"), "先看 CI 再开 PR");
});

test("modelShortLabel maps DeepSeek ids", () => {
  assert.equal(modelShortLabel("deepseek-v4-flash"), "Flash");
  assert.equal(modelShortLabel("deepseek-v4-pro"), "Pro");
});

test("holdPadLabel is click-to-talk when the engine exists", () => {
  assert.equal(holdPadLabel({ supported: true, holding: false }), "点一下开始说话");
  assert.equal(holdPadLabel({ supported: true, holding: true }), "正在听…再点一下完成");
  assert.equal(holdPadLabel({ supported: true, holding: false, finishing: true }), "正在转文字…");
  assert.equal(holdPadLabel({ supported: false, holding: false, followUp: true }), "继续说一句…");
});

test("startSpeechRecognition joins interim then final text", async () => {
  const engine: SpeechEngine = {
    lang: "",
    interimResults: false,
    continuous: false,
    onresult: null,
    onerror: null,
    onend: null,
    start() {},
    stop() {
      this.onend?.();
    },
  };
  const previews: string[] = [];
  const session = startSpeechRecognition(engine, (text) => previews.push(text));
  assert.equal(engine.lang, "zh-CN");
  engine.onresult?.({
    results: [
      { isFinal: true, 0: { transcript: "给仓库 " } },
      { isFinal: false, 0: { transcript: "加 README" } },
    ],
  });
  assert.equal(previews.at(-1), "给仓库 加 README");
  const spoken = await session.stop();
  assert.equal(spoken, "给仓库");
});

test("collectSpeechTranscript keeps finals and preview", () => {
  const next = collectSpeechTranscript([{ isFinal: true, 0: { transcript: "修好了" } }]);
  assert.equal(next.finalText, "修好了");
  assert.equal(next.preview, "修好了");
});

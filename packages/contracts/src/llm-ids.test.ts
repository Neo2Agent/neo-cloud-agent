import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_MODELS,
  canonicalizeLlmModel,
  chatModelLabel,
  chatModelShortLabel,
  decorateCatalogIds,
  isChatCatalogModel,
  isDeepseekFlashModel,
  isStepfunModel,
  resolveCatalogSelection,
  resolvePublicChatModel,
  STEP_5_PREVIEW_MODEL,
  visionModelFor,
} from "./llm-ids.js";

test("CHAT_MODELS static fallback lists Flash and Step 5 Preview", () => {
  assert.deepEqual(
    CHAT_MODELS.map((item) => item.id),
    ["deepseek-flash", "step-5-preview"],
  );
});

test("canonicalizeLlmModel maps StepFun aliases without swallowing them as Flash", () => {
  assert.equal(canonicalizeLlmModel("deepseek", "step-5-preview"), STEP_5_PREVIEW_MODEL);
  assert.equal(canonicalizeLlmModel("deepseek", "neo/step"), STEP_5_PREVIEW_MODEL);
  assert.equal(canonicalizeLlmModel("deepseek", "step5"), STEP_5_PREVIEW_MODEL);
  assert.equal(canonicalizeLlmModel("openai", "neo/stepfun"), STEP_5_PREVIEW_MODEL);
  assert.equal(canonicalizeLlmModel("deepseek", "custom-local"), "custom-local");
  assert.equal(isStepfunModel("neo/step"), true);
  assert.equal(isDeepseekFlashModel("step-5-preview"), false);
  assert.equal(isDeepseekFlashModel("deepseek-v4-pro"), true);
});

test("chat labels follow the model id, not the gateway upstream mode", () => {
  assert.equal(chatModelLabel("deepseek-flash"), "DeepSeek Flash 4.1");
  assert.equal(chatModelLabel("step-5-preview"), "Step 5 Preview");
  assert.equal(chatModelLabel("neo/step"), "Step 5 Preview");
  assert.equal(chatModelShortLabel("deepseek-v4-pro"), "Flash");
  assert.equal(chatModelShortLabel("step-5-preview"), "Step 5");
});

test("resolvePublicChatModel keeps Step 5 and remaps DeepSeek aliases", () => {
  assert.equal(resolvePublicChatModel("deepseek", "deepseek-v4-flash"), "deepseek-flash");
  assert.equal(resolvePublicChatModel("deepseek", "neo/step"), "step-5-preview");
  assert.equal(resolvePublicChatModel("openai", "step-5-preview"), "step-5-preview");
  assert.equal(resolvePublicChatModel("openai", "gpt-4o"), "gpt-4o");
  assert.equal(resolvePublicChatModel("mock", null), "deepseek-flash");
  assert.equal(resolvePublicChatModel("mock", "mock"), "deepseek-flash");
  assert.equal(resolvePublicChatModel("mock", "step-5-preview"), "step-5-preview");
  assert.equal(resolveCatalogSelection(null), "deepseek-flash");
  assert.equal(resolveCatalogSelection("mock"), "deepseek-flash");
  assert.equal(resolveCatalogSelection("neo/step"), "step-5-preview");
});

test("decorateCatalogIds drops non-chat models and aliases to official ids", () => {
  assert.equal(isChatCatalogModel("stepaudio-3-tts"), false);
  assert.equal(isChatCatalogModel("step-5-preview"), true);
  assert.deepEqual(
    decorateCatalogIds(["deepseek-chat", "step-5-preview", "tts-1", "neo/step", ""]),
    [
      { id: "deepseek-flash", label: "DeepSeek Flash 4.1" },
      { id: "step-5-preview", label: "Step 5 Preview" },
    ],
  );
});

test("visionModelFor keeps Step 5 Preview", () => {
  assert.equal(visionModelFor("neo/step"), "step-5-preview");
  assert.equal(visionModelFor("deepseek-v4-flash"), "deepseek-flash");
});

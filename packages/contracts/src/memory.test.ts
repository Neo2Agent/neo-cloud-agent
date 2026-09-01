import assert from "node:assert/strict";
import test from "node:test";
import { appendUserMemory, formatUserMemory } from "./memory.js";

test("formatUserMemory writes a short bullet list", () => {
  assert.equal(formatUserMemory([]), "");
  assert.equal(formatUserMemory([{ text: "  " }]), "");
  const text = formatUserMemory([{ text: "用 pnpm" }, { text: "不要 force push" }]);
  assert.match(text, /# User memory/);
  assert.match(text, /- 用 pnpm/);
  assert.match(text, /- 不要 force push/);
});

test("appendUserMemory skips empty blocks", () => {
  assert.equal(appendUserMemory("base", ""), "base");
  assert.equal(appendUserMemory("base", "  \n"), "base");
  assert.match(appendUserMemory("base", "- 用 pnpm"), /Recalled user memory/);
  assert.match(appendUserMemory("base", "- 用 pnpm"), /用 pnpm/);
  assert.match(appendUserMemory("base", "- 用 pnpm"), /neo_memory_add/);
  assert.match(appendUserMemory("base", "- 用 pnpm"), /neo_memory_search/);
  assert.match(appendUserMemory("base", "- 用 pnpm"), /neo_memory_update/);
  assert.match(appendUserMemory("base", "- 用 pnpm"), /neo_memory_delete/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { prepareMarkdown } from "./markdown.js";

test("prepareMarkdown closes an open fence while streaming", () => {
  const fence = "```";
  assert.equal(prepareMarkdown(`${fence}ts\nconst x = 1`, true).endsWith(`${fence}\n`), true);
  assert.equal(prepareMarkdown("hello **world**", true), "hello **world**");
  assert.equal(prepareMarkdown(`${fence}ts\nconst x = 1\n${fence}`, false), `${fence}ts\nconst x = 1\n${fence}`);
});

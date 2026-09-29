import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));

test("a project chat does not offer owner transfer or a standing handoff form", () => {
  const header = readFileSync(path.join(here, "ChatHeader.tsx"), "utf8");
  const page = readFileSync(path.join(here, "ProjectChatPage.tsx"), "utf8");
  const chrome = `${header}\n${page}`;
  assert.doesNotMatch(header, /hostHint|run-host-hint|房主/);
  assert.match(header, /邀请加入这条对话/);
  assert.match(header, /useDismissOnOutside/);
  assert.doesNotMatch(header, /aria-label="搜索"/);
  assert.doesNotMatch(chrome, /转交房主/);
  assert.doesNotMatch(chrome, /流转为待办/);
  assert.doesNotMatch(chrome, /保存到项目/);
  assert.doesNotMatch(page, /RunChrome/);
});

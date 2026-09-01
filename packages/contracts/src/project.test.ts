import assert from "node:assert/strict";
import test from "node:test";
import { appendProjectInstruction, canManageProject, formatProjectMemory } from "./project.js";

test("project helpers format memory and gate roles", () => {
  assert.equal(canManageProject("owner"), true);
  assert.equal(canManageProject("admin"), true);
  assert.equal(canManageProject("member"), false);
  assert.match(formatProjectMemory({ name: "青柠", instruction: "用中文回复" }), /青柠/);
  assert.match(formatProjectMemory({ name: "空", instruction: "  " }), /还没有写指令/);
  assert.match(
    formatProjectMemory({ name: "青柠", instruction: "用中文" }, [{ path: "a.md", size: 3 }], { attached: ["a.md"] }),
    /这次带上的文件/,
  );
  assert.equal(appendProjectInstruction("base", ""), "base");
  assert.match(appendProjectInstruction("base", "先跑测试"), /先跑测试/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buddySkillsFromRecipes, padBuddyGrid } from "./catalog.js";

test("buddySkillsFromRecipes maps known recipe ids", () => {
  const skills = buddySkillsFromRecipes([
    { id: "recipe_fix_ci", title: "修 CI 红" },
    { id: "unknown", title: "自定义" },
  ]);
  assert.deepEqual(skills[0], { id: "recipe_fix_ci", label: "修 CI", icon: "code" });
  assert.deepEqual(skills[1], { id: "unknown", label: "自定义", icon: "grid" });
});

test("padBuddyGrid centers a leftover item in a 3-column row", () => {
  assert.deepEqual(
    padBuddyGrid(["a", "b", "c", "d"], 3),
    ["a", "b", "c", undefined, "d", undefined],
  );
  assert.deepEqual(padBuddyGrid(["a", "b", "c", "d", "e"], 3), ["a", "b", "c", "d", "e", undefined]);
  assert.deepEqual(padBuddyGrid(["a", "b", "c"], 3), ["a", "b", "c"]);
});

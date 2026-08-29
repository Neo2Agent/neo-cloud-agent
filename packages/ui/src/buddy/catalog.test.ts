import assert from "node:assert/strict";
import test from "node:test";
import { buddySkillsFromRecipes } from "./catalog.js";

test("buddySkillsFromRecipes maps known recipe ids", () => {
  const skills = buddySkillsFromRecipes([
    { id: "recipe_fix_ci", title: "修 CI 红" },
    { id: "unknown", title: "自定义" },
  ]);
  assert.deepEqual(skills[0], { id: "recipe_fix_ci", label: "修 CI", icon: "code" });
  assert.deepEqual(skills[1], { id: "unknown", label: "自定义", icon: "grid" });
});

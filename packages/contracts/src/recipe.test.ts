import assert from "node:assert/strict";
import test from "node:test";
import {
  BUNDLED_RECIPES,
  PROJECT_TEMPLATES,
  formatHandoffMarkdown,
  matchIntentCapsules,
  projectTemplateById,
  recipeById,
} from "./recipe.js";

test("bundled recipes and templates have stable ids", () => {
  assert.equal(BUNDLED_RECIPES.length >= 8, true);
  assert.ok(recipeById("recipe_review_pr")?.pluginIds?.includes("plug_pr_review"));
  assert.equal(projectTemplateById("ship-change")?.expertIds.includes("exp_implementer"), true);
  assert.ok(PROJECT_TEMPLATES.every((item) => item.instruction.length > 20));
});

test("intent capsules stay quiet until the prompt is long enough", () => {
  assert.deepEqual(matchIntentCapsules("审查"), []);
  const hits = matchIntentCapsules("请审查这次改动的 diff");
  assert.equal(hits[0]?.id, "intent_review");
  assert.ok(matchIntentCapsules("帮我开一个 draft PR 把登录修好")[0]?.expertTeamId === "team_ship_change");
});

test("handoff markdown keeps prompt, note, and recent turns", () => {
  const text = formatHandoffMarkdown({
    fromRunId: "run_abc",
    fromPrompt: "修登录限流",
    note: "B 接着开 PR",
    actorEmail: "a@example.com",
    messages: [
      { role: "user", text: "先看鉴权" },
      { role: "assistant", text: "准备改 rate-limit.ts" },
    ],
    artifacts: [{ name: "notes.txt" }],
    pullRequests: [{ url: "https://github.com/acme/app/pull/3" }],
  });
  assert.match(text, /run_abc/);
  assert.match(text, /修登录限流/);
  assert.match(text, /B 接着开 PR/);
  assert.match(text, /rate-limit.ts/);
  assert.match(text, /notes.txt/);
  assert.match(text, /pull\/3/);
});

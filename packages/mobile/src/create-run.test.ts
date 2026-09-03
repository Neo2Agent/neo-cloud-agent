import assert from "node:assert/strict";
import test from "node:test";
import { askPrompt, cloudRunRequest } from "./create-run.js";
import { CLOUD_TARGET } from "./place.js";

test("cloudRunRequest always posts the cloud target", () => {
  const body = cloudRunRequest({ prompt: "hello", source: "ios", envId: "env_1", model: "deepseek-v4-flash", projectId: "p1" });
  assert.deepEqual(body.target, CLOUD_TARGET);
  assert.equal(body.source, "ios");
  assert.equal(body.projectId, "p1");
  assert.deepEqual(body.repoUrls, []);
});

test("a summoned expert team reaches the API instead of being dropped", () => {
  const body = cloudRunRequest({ prompt: "交付这条改动", source: "android", expert: { expertTeamId: "team_ship_change" } });
  assert.equal(body.expertTeamId, "team_ship_change");
  assert.equal(body.expertId, undefined);
});

test("expert and team never ship together", () => {
  const body = cloudRunRequest({
    prompt: "审查",
    source: "ios",
    expert: { expertId: "exp_reviewer", expertTeamId: "team_ship_change" },
  });
  assert.equal(body.expertTeamId, "team_ship_change");
  assert.equal(body.expertId, undefined);
});

test("an empty pick sends neither expert field", () => {
  const body = cloudRunRequest({ prompt: "hi", source: "ios", expert: {} });
  assert.equal(body.expertId, undefined);
  assert.equal(body.expertTeamId, undefined);
});

test("enabled skills ride along, and an empty list stays undefined", () => {
  assert.deepEqual(
    cloudRunRequest({ prompt: "hi", source: "ios", pluginIds: ["plug_pr_review"] }).pluginIds,
    ["plug_pr_review"],
  );
  assert.equal(cloudRunRequest({ prompt: "hi", source: "ios", pluginIds: [] }).pluginIds, undefined);
});

test("ask mode prefixes the prompt and keeps the cloud target", () => {
  const body = cloudRunRequest({ prompt: "这段鉴权怎么走", source: "ios", mode: "ask" });
  assert.equal(body.mode, "ask");
  assert.match(body.prompt, /^只阅读和回答/);
  assert.match(body.prompt, /这段鉴权怎么走$/);
  assert.deepEqual(body.target, CLOUD_TARGET);
});

test("agent mode leaves the prompt alone", () => {
  assert.equal(askPrompt("改一下", "agent"), "改一下");
  assert.equal(askPrompt("改一下"), "改一下");
  assert.equal(cloudRunRequest({ prompt: "改一下", source: "ios" }).mode, undefined);
});

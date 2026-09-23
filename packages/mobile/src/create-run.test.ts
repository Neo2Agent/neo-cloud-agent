import assert from "node:assert/strict";
import test from "node:test";
import { cloudFollowUp, cloudRunRequest } from "./create-run.js";
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

test("prompts go through untouched and follow-ups carry queue / steer", () => {
  const body = cloudRunRequest({ prompt: "这段鉴权怎么走", source: "ios" });
  assert.equal(body.prompt, "这段鉴权怎么走");
  assert.deepEqual(body.target, CLOUD_TARGET);
  assert.deepEqual(cloudFollowUp({ text: "再看看" }), { text: "再看看", images: undefined });
  assert.equal(cloudFollowUp({ text: "先停一下", delivery: "steer" }).delivery, "steer");
  assert.equal(cloudFollowUp({ text: "", delivery: "follow_up" }).text, "（图片）");
});

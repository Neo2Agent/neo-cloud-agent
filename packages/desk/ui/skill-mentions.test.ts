import assert from "node:assert/strict";
import test from "node:test";
import type { PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import type { ListedSkill } from "../src/skill-list";
import { resolveSkillMention, resolveSkillUse, skillComposerMentions } from "./skill-mentions";

function localSkill(origin: ListedSkill["origin"], slug: string, name = slug): ListedSkill {
  return { origin, slug, name, description: `${name} handbook`, relativePath: `${slug}/SKILL.md` };
}

function plugin(slug: string, extra?: Partial<PluginCatalogItem>): PluginCatalogItem {
  return {
    id: `plug_${slug.replace(/-/g, "_")}`,
    slug,
    name: slug,
    version: "1.0.0",
    description: slug,
    kind: "skill",
    skills: [slug],
    visibility: "bundled",
    source: { type: "bundled", digest: "x" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    installed: true,
    enabled: true,
    pinned: false,
    ...extra,
  };
}

test("composer mentions put workspace skills ahead of system and official", () => {
  const mentions = skillComposerMentions({
    workspace: [localSkill("workspace", "foo", "Foo")],
    system: [localSkill("system", "pr-review"), localSkill("system", "foo", "Foo system")],
    plugins: [plugin("pr-review"), plugin("incident-brief"), plugin("off", { installed: false })],
  });
  assert.deepEqual(
    mentions.map((item) => item.id),
    ["workspace:foo", "system:pr-review", "plug_incident_brief"],
  );
});

test("using a system skill that is also in the catalog keeps pluginIds", () => {
  const catalog = [plugin("pr-review")];
  const resolved = resolveSkillUse(localSkill("system", "pr-review"), catalog);
  assert.equal("plugin" in resolved && resolved.plugin.id, "plug_pr_review");
});

test("using a workspace skill never maps onto a catalog install", () => {
  const resolved = resolveSkillUse(localSkill("workspace", "pr-review"), [plugin("pr-review")]);
  assert.equal("local" in resolved && resolved.local.origin, "workspace");
});

test("mention ids resolve local keys and catalog plugin ids", () => {
  const workspace = [localSkill("workspace", "foo")];
  const system = [localSkill("system", "pr-review")];
  const plugins = [plugin("pr-review")];
  assert.equal(
    "local" in (resolveSkillMention({ mentionId: "workspace:foo", workspace, system, plugins }) ?? {}),
    true,
  );
  assert.equal(
    "plugin" in (resolveSkillMention({ mentionId: "system:pr-review", workspace, system, plugins }) ?? {}),
    true,
  );
  assert.equal(
    "plugin" in (resolveSkillMention({ mentionId: "plug_pr_review", workspace, system, plugins }) ?? {}),
    true,
  );
});

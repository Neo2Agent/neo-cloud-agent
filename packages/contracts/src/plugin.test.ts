import assert from "node:assert/strict";
import test from "node:test";
import { BUNDLED_PLUGINS, bundledPluginById, pluginDigest } from "./bundled-plugins.js";
import {
  assertSafeRelativePath,
  isSafeRelativePath,
  overlayCatalogItem,
  parseMarketplaceFile,
  parsePluginManifest,
  parseSkillMd,
  sortPluginsForCatalog,
  type PluginInstall,
} from "./plugin.js";

test("bundled plugins have stable slugs and valid SKILL.md", () => {
  assert.deepEqual(
    BUNDLED_PLUGINS.map((item) => item.slug),
    ["pr-review", "release-notes", "repo-scout", "incident-brief"],
  );
  for (const plugin of BUNDLED_PLUGINS) {
    assert.equal(plugin.id.startsWith("plug_"), true);
    assert.equal(plugin.visibility, "bundled");
    assert.equal(plugin.source.digest.length, 64);
    assert.equal(plugin.skillContents.length, 1);
    const parsed = parseSkillMd(plugin.skillContents[0]?.raw ?? "");
    assert.equal("error" in parsed, false);
    if (!("error" in parsed)) {
      assert.equal(parsed.name, plugin.slug);
    }
  }
  assert.equal(bundledPluginById("pr-review")?.id, "plug_pr_review");
  assert.equal(bundledPluginById("plug_repo_scout")?.slug, "repo-scout");
});

test("parseSkillMd accepts Agent Skills frontmatter and rejects bad names", () => {
  const ok = parseSkillMd(`---
name: hello-world
description: Greet the user when they say hi.
---

Say hello.
`);
  assert.equal("error" in ok, false);
  if (!("error" in ok)) {
    assert.equal(ok.name, "hello-world");
    assert.match(ok.body, /Say hello/);
  }
  assert.equal("error" in parseSkillMd("no frontmatter"), true);
  assert.match((parseSkillMd(`---\nname: Hello\ndescription: x\n---\n\nbody\n`) as { error: string }).error, /kebab-case/);
  assert.match(
    (parseSkillMd(`---\nname: ok\ndescription: \n---\n\nbody\n`) as { error: string }).error,
    /description/,
  );
});

test("plugin and marketplace parsers skip escapes and npm", () => {
  const manifest = parsePluginManifest({
    name: "my-plugin",
    version: "1.0.0",
    description: "Reusable greeting",
    skills: "./skills/",
    license: "MIT",
  });
  assert.equal("error" in manifest, false);
  if (!("error" in manifest)) {
    assert.equal(manifest.skills, "./skills/");
    assert.equal(manifest.extra.license, "MIT");
  }
  assert.match((parsePluginManifest({ name: "x", description: "d", skills: "../etc" }) as { error: string }).error, /路径/);
  assert.equal(isSafeRelativePath("./plugins/foo"), true);
  assert.equal(isSafeRelativePath("../etc/passwd"), false);
  assert.equal(isSafeRelativePath("/etc/passwd"), false);
  assert.throws(() => assertSafeRelativePath("./foo/../../etc"), /路径/);

  const market = parseMarketplaceFile({
    name: "local-repo",
    interface: { displayName: "Local" },
    plugins: [
      { name: "ok", source: { source: "local", path: "./plugins/ok" } },
      { name: "npm-helper", source: { source: "npm", package: "@x/y" } },
      { name: "escape", source: "../outside" },
      { name: "" },
    ],
  });
  assert.equal("error" in market, false);
  if (!("error" in market)) {
    assert.equal(market.plugins.length, 3);
    assert.equal(market.plugins.find((item) => item.name === "ok")?.skipped, undefined);
    assert.match(market.plugins.find((item) => item.name === "npm-helper")?.skipped ?? "", /npm/);
    assert.match(market.plugins.find((item) => item.name === "escape")?.skipped ?? "", /相对路径/);
  }
});

test("catalog sort pins project plugins and digest is stable", () => {
  const first = BUNDLED_PLUGINS[0]!;
  const second = BUNDLED_PLUGINS[1]!;
  const items = sortPluginsForCatalog(
    [overlayCatalogItem(publicOf(second)), overlayCatalogItem(publicOf(first), null, [first.id])],
    [first.id],
  );
  assert.equal(items[0]?.id, first.id);
  assert.equal(items[0]?.pinned, true);
  assert.equal(items[0]?.enabled, true);
  const disabledInstall: PluginInstall = {
    id: "inst_x",
    pluginId: first.id,
    version: first.version,
    digest: first.source.digest,
    scope: "user",
    enabled: false,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
  const pinnedWhileOff = overlayCatalogItem(publicOf(first), disabledInstall, [first.id]);
  assert.equal(pinnedWhileOff.enabled, true);
  assert.equal(pluginDigest(first.skillContents), first.source.digest);
  assert.equal(pluginDigest(first.skillContents), pluginDigest(first.skillContents));
});

function publicOf(plugin: (typeof BUNDLED_PLUGINS)[number]) {
  const { skillContents: _omit, ...rest } = plugin;
  return rest;
}

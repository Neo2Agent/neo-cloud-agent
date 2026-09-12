import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { deskStateDir, migrateLegacyDeskState, neoHomeDir, skillsNeoDir } from "./home.js";
import { bundledSkillsSourceDir, syncSkillsNeo } from "./skills-neo.js";

test("Neo home is ~/.neo, skills live in skills-neo", () => {
  assert.equal(neoHomeDir("/Users/ada"), path.join("/Users/ada", ".neo"));
  assert.equal(deskStateDir("/Users/ada"), path.join("/Users/ada", ".neo", "desk"));
  assert.equal(skillsNeoDir("/Users/ada"), path.join("/Users/ada", ".neo", "skills-neo"));
});

test("legacy userData/neo-desk copies into ~/.neo/desk once", () => {
  const home = mkdtempSync(path.join(tmpdir(), "neo-home-"));
  const legacy = mkdtempSync(path.join(tmpdir(), "neo-legacy-"));
  writeFileSync(path.join(legacy, "session.json"), '{"token":"abc"}\n');
  const dest = migrateLegacyDeskState({ legacyDir: legacy, homeDir: home });
  assert.equal(dest, deskStateDir(home));
  assert.match(readFileSync(path.join(dest, "session.json"), "utf8"), /abc/);
  writeFileSync(path.join(legacy, "session.json"), '{"token":"newer"}\n');
  migrateLegacyDeskState({ legacyDir: legacy, homeDir: home });
  assert.match(readFileSync(path.join(dest, "session.json"), "utf8"), /abc/);
});

test("syncSkillsNeo writes Cursor-shaped folders plus a manifest", () => {
  const dest = path.join(mkdtempSync(path.join(tmpdir(), "neo-skills-")), "skills-neo");
  const source = bundledSkillsSourceDir();
  const first = syncSkillsNeo({ destDir: dest, sourceDir: source, now: "2026-09-02T00:00:00.000Z" });
  assert.equal(first.wrote, true);
  assert.ok(first.skills.includes("pr-review"));
  assert.equal(existsSync(path.join(dest, "pr-review", "SKILL.md")), true);
  assert.equal(existsSync(path.join(dest, ".sync-manifest.json")), true);
  const manifest = JSON.parse(readFileSync(path.join(dest, ".sync-manifest.json"), "utf8")) as {
    skills: Array<{ name: string }>;
  };
  assert.deepEqual(
    manifest.skills.map((item) => item.name),
    first.skills,
  );
  const again = syncSkillsNeo({ destDir: dest, sourceDir: source });
  assert.equal(again.wrote, false);
});

test("packaged Desk reads bundled skills from Resources/skills", () => {
  assert.equal(
    bundledSkillsSourceDir({ NEO_DESK_PACKAGED: "1", NEO_DESK_RESOURCES: "/app/Resources" }),
    path.join("/app/Resources", "skills"),
  );
});

test("an empty source directory does not invent skills", () => {
  const dest = path.join(mkdtempSync(path.join(tmpdir(), "neo-skills-empty-")), "skills-neo");
  const source = mkdtempSync(path.join(tmpdir(), "neo-skills-src-"));
  mkdirSync(path.join(source, "notes"));
  const result = syncSkillsNeo({ destDir: dest, sourceDir: source });
  assert.deepEqual(result.skills, []);
  assert.equal(existsSync(path.join(dest, ".sync-manifest.json")), true);
});

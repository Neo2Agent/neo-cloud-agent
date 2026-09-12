import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { isAllowedSkillScanFolder, listLocalSkills, listedSkillKey, parseListedSkillKey } from "./skill-scan.js";

function writeSkill(dir: string, name: string, description: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

test("system skills are one SKILL.md per child directory", () => {
  const systemDir = mkdtempSync(path.join(tmpdir(), "neo-skill-sys-"));
  writeSkill(path.join(systemDir, "pr-review"), "pr-review", "Review a pull request.");
  writeSkill(path.join(systemDir, "repo-scout"), "repo-scout", "Scout a repository.");
  writeFileSync(path.join(systemDir, ".sync-manifest.json"), "{}\n");
  const listed = listLocalSkills({ systemDir });
  assert.deepEqual(
    listed.system.map((item) => item.slug),
    ["pr-review", "repo-scout"],
  );
  assert.equal(listed.system[0]?.relativePath, "pr-review/SKILL.md");
  assert.equal(listed.system[0]?.origin, "system");
  assert.deepEqual(listed.workspace, []);
});

test("workspace scan reads WORKSPACE_SKILL_DIRS one level down and skips run scratch", () => {
  const systemDir = mkdtempSync(path.join(tmpdir(), "neo-skill-sys-"));
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "neo-skill-ws-"));
  writeSkill(path.join(workspaceDir, ".cursor", "skills", "foo"), "foo", "Repo handbook foo.");
  writeSkill(path.join(workspaceDir, ".neo", "skills", "bar"), "bar", "Repo handbook bar.");
  writeSkill(path.join(workspaceDir, ".neo", "runs", "run_1", "skills", "ephemeral"), "ephemeral", "Run scratch only.");
  mkdirSync(path.join(workspaceDir, ".cursor", "skills", "nested", "deep"), { recursive: true });
  writeSkill(path.join(workspaceDir, ".cursor", "skills", "nested", "deep"), "deep", "Must not be recursed.");
  const listed = listLocalSkills({ systemDir, workspaceDir });
  assert.deepEqual(
    listed.workspace.map((item) => item.slug),
    ["bar", "foo"],
  );
  assert.equal(listed.workspace.find((item) => item.slug === "foo")?.relativePath, ".cursor/skills/foo/SKILL.md");
  assert.equal(
    listed.workspace.some((item) => item.slug === "ephemeral" || item.slug === "deep"),
    false,
  );
});

test("a workspace skill with the same name marks overridesSystem", () => {
  const systemDir = mkdtempSync(path.join(tmpdir(), "neo-skill-sys-"));
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "neo-skill-ws-"));
  writeSkill(path.join(systemDir, "pr-review"), "pr-review", "Bundled review.");
  writeSkill(path.join(workspaceDir, ".cursor", "skills", "pr-review"), "pr-review", "Repo review wins.");
  const listed = listLocalSkills({ systemDir, workspaceDir });
  const repo = listed.workspace.find((item) => item.slug === "pr-review");
  assert.equal(repo?.overridesSystem, true);
  assert.match(repo?.description ?? "", /Repo review/);
  assert.equal(listed.system[0]?.overridesSystem, undefined);
});

test("invalid SKILL.md and missing folders are skipped, not thrown", () => {
  const systemDir = mkdtempSync(path.join(tmpdir(), "neo-skill-sys-"));
  mkdirSync(path.join(systemDir, "broken"));
  writeFileSync(path.join(systemDir, "broken", "SKILL.md"), "no frontmatter\n");
  const listed = listLocalSkills({ systemDir, workspaceDir: path.join(systemDir, "no-such-workspace") });
  assert.deepEqual(listed.system, []);
  assert.equal(listed.skipped.some((item) => item.relativePath === "broken/SKILL.md"), true);
});

test("isAllowedSkillScanFolder only accepts the selected or bound folder", () => {
  const home = mkdtempSync(path.join(tmpdir(), "neo-skill-home-"));
  const bound = path.join(home, "repo");
  const selected = path.join(home, "picked");
  mkdirSync(bound);
  mkdirSync(selected);
  assert.equal(
    isAllowedSkillScanFolder({ folder: bound, boundFolders: [bound], selectedFolder: selected }),
    true,
  );
  assert.equal(
    isAllowedSkillScanFolder({ folder: selected, boundFolders: [bound], selectedFolder: selected }),
    true,
  );
  assert.equal(
    isAllowedSkillScanFolder({ folder: path.join(home, "other"), boundFolders: [bound], selectedFolder: selected }),
    false,
  );
  assert.equal(isAllowedSkillScanFolder({ folder: "/etc", boundFolders: [bound], selectedFolder: selected }), false);
  assert.equal(isAllowedSkillScanFolder({ boundFolders: [bound], selectedFolder: selected }), false);
});

test("listed skill keys round-trip origin and slug", () => {
  assert.equal(listedSkillKey({ origin: "workspace", slug: "foo" }), "workspace:foo");
  assert.deepEqual(parseListedSkillKey("system:pr-review"), { origin: "system", slug: "pr-review" });
  assert.equal(parseListedSkillKey("plug_pr_review"), null);
});

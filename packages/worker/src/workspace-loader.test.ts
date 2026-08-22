import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createWorkspaceLoader, existingWorkspaceSkillPaths, projectContextFilesOnly } from "./workspace-loader.js";

test("projectContextFilesOnly drops ancestor files outside the workspace", () => {
  const cwd = "/tmp/run-workspace";
  assert.deepEqual(
    projectContextFilesOnly(cwd, [
      { path: "/tmp/run-workspace/AGENTS.md", content: "in" },
      { path: "/tmp/AGENTS.md", content: "out" },
      { path: "/AGENTS.md", content: "root" },
    ]),
    [{ path: "/tmp/run-workspace/AGENTS.md", content: "in" }],
  );
});

test("workspace loader reads repo AGENTS.md and skills, not host paths", async () => {
  const parent = mkdtempSync(path.join(tmpdir(), "neo-loader-parent-"));
  const cwd = path.join(parent, "workspace");
  const agentDir = path.join(parent, "agent");
  mkdirSync(path.join(cwd, ".cursor", "skills", "demo-skill"), { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(parent, "AGENTS.md"), "# Host instructions\nDo not load this.\n");
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Project instructions\nUse the demo skill.\n");
  writeFileSync(
    path.join(cwd, ".cursor/skills/demo-skill/SKILL.md"),
    `---
name: demo-skill
description: Workspace skill for tests
---

Say hello from the skill.
`,
  );
  assert.deepEqual(existingWorkspaceSkillPaths(cwd), [path.join(cwd, ".cursor/skills")]);
  const loader = await createWorkspaceLoader({
    cwd,
    agentDir,
    systemPrompt: "cloud prompt",
    settingsManager: SettingsManager.inMemory({}),
  });
  const files = loader.getAgentsFiles().agentsFiles;
  assert.equal(files.some((file) => file.content.includes("Project instructions")), true);
  assert.equal(files.some((file) => file.content.includes("Host instructions")), false);
  assert.equal(loader.getSystemPrompt(), "cloud prompt");
  assert.deepEqual(
    loader.getSkills().skills.map((skill) => skill.name),
    ["demo-skill"],
  );
  assert.equal(loader.getExtensions().extensions.some((item) => item.path.includes("neo-workspace-hooks")), true);
});

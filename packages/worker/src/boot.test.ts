import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runWorkspaceBoot, stopTerminals } from "./boot.js";

test("runWorkspaceBoot runs start then terminals and never start during install", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-boot-"));
  mkdirSync(path.join(dir, ".neo"), { recursive: true });
  writeFileSync(
    path.join(dir, ".neo/environment.json"),
    JSON.stringify({
      install: "printf no > .neo-installed",
      start: "printf 'started\\n' > .neo-started",
      terminals: [{ name: "note", command: "printf 'term\\n' > .neo-terminal" }],
    }),
  );
  const result = await runWorkspaceBoot({ runId: "run-boot", workspaceDir: dir });
  assert.equal(readFileSync(path.join(dir, ".neo-started"), "utf8").trim(), "started");
  assert.equal(readFileSync(path.join(dir, ".neo-terminal"), "utf8").trim(), "term");
  assert.equal(existsInstalled(dir), false);
  assert.ok(result.events.some((item) => item.kind === "run.start_succeeded"));
  assert.ok(result.events.some((item) => item.kind === "run.terminal_started"));
  stopTerminals(result.terminals);
});

function existsInstalled(dir: string): boolean {
  try {
    readFileSync(path.join(dir, ".neo-installed"));
    return true;
  } catch {
    return false;
  }
}

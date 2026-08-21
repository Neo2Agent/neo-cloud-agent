import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  const deadline = Date.now() + 2000;
  while (!existsSync(path.join(dir, ".neo-terminal")) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(readFileSync(path.join(dir, ".neo-started"), "utf8").trim(), "started");
  assert.equal(readFileSync(path.join(dir, ".neo-terminal"), "utf8").trim(), "term");
  assert.equal(existsInstalled(dir), false);
  assert.equal(result.fatal, false);
  assert.ok(result.events.some((item) => item.kind === "run.start_succeeded"));
  assert.ok(result.events.some((item) => item.kind === "run.terminal_started"));
  stopTerminals(result.terminals);
});

test("start failure is non-fatal by default and still starts terminals", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-boot-fail-"));
  mkdirSync(path.join(dir, ".neo"), { recursive: true });
  writeFileSync(
    path.join(dir, ".neo/environment.json"),
    JSON.stringify({
      start: "exit 7",
      terminals: [{ name: "note", command: "printf 'term\\n' > .neo-terminal" }],
    }),
  );
  const result = await runWorkspaceBoot({ runId: "run-start-fail", workspaceDir: dir });
  const deadline = Date.now() + 2000;
  while (!existsSync(path.join(dir, ".neo-terminal")) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(result.fatal, false);
  assert.ok(result.events.some((item) => item.kind === "run.start_failed"));
  assert.equal(result.events.find((item) => item.kind === "run.start_failed")?.data?.fatal, false);
  assert.ok(result.events.some((item) => item.kind === "run.terminal_started"));
  stopTerminals(result.terminals);
});

test("startMustSucceed blocks the agent and skips terminals", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-boot-must-"));
  mkdirSync(path.join(dir, ".neo"), { recursive: true });
  writeFileSync(
    path.join(dir, ".neo/environment.json"),
    JSON.stringify({
      start: "exit 7",
      startMustSucceed: true,
      terminals: [{ name: "note", command: "printf 'term\\n' > .neo-terminal" }],
    }),
  );
  const result = await runWorkspaceBoot({ runId: "run-start-must", workspaceDir: dir });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(result.fatal, true);
  assert.equal(result.events.find((item) => item.kind === "run.start_failed")?.data?.fatal, true);
  assert.equal(result.events.some((item) => item.kind === "run.terminal_started"), false);
  assert.equal(existsSync(path.join(dir, ".neo-terminal")), false);
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

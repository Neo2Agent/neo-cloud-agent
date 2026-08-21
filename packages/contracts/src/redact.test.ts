import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "./events.js";
import { redactRunEvent, redactText, secretValuesFromEnv } from "./redact.js";

test("collects long secret values and ignores short ones", () => {
  const secrets = secretValuesFromEnv({
    DEEPSEEK_API_KEY: "sk-deepseek-secret",
    OPENAI_API_KEY: "short",
    HOME: "/tmp",
    NEO_RUNTIME_SECRET_DB: "postgres-password-1",
  });
  assert.deepEqual(secrets, ["sk-deepseek-secret", "postgres-password-1"]);
});

test("redacts the longest secret first so overlapping tokens stay covered", () => {
  assert.equal(redactText("prefix-sk-aaaa-bbbb suffix", ["sk-aaaa-bbbb", "sk-aaaa"]), "prefix-[REDACTED] suffix");
});

test("redactRunEvent scrubs title, detail, and nested data", () => {
  const event: RunEvent = {
    id: "e1",
    runId: "r1",
    createdAt: "2026-08-21T00:00:00.000Z",
    category: "agent_run",
    level: "info",
    kind: "tool.start",
    title: "bash sk-deepseek-secret",
    detail: "token=sk-deepseek-secret",
    data: { args: { command: "echo sk-deepseek-secret" } },
  };
  const clean = redactRunEvent(event, ["sk-deepseek-secret"]);
  assert.equal(clean.title, "bash [REDACTED]");
  assert.equal(clean.detail, "token=[REDACTED]");
  assert.deepEqual(clean.data, { args: { command: "echo [REDACTED]" } });
});

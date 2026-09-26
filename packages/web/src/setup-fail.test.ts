import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import {
  SETUP_FAIL_DIAG_OPEN_LABEL,
  setupDiagToggleLabel,
  setupFailLogText,
  setupFailureTitle,
} from "@neo-cloud-agent/contracts/setup-fail";

const CLONE_FAIL: TranscriptMessage = {
  id: "c1",
  role: "setup",
  text: "仓库克隆超时：app，已等待 180 秒。",
  detail: "git clone timed out after 180000ms\nfatal: unable to access",
  createdAt: "2026-09-26T00:00:00.000Z",
  kind: "scm.clone_failed",
  level: "error",
};

test("查看诊断 expands the clone stderr snippet, not an inspector tab", () => {
  assert.equal(setupDiagToggleLabel(false), SETUP_FAIL_DIAG_OPEN_LABEL);
  assert.equal(setupFailureTitle(CLONE_FAIL), "仓库克隆超时：app，已等待 180 秒。");
  assert.match(setupFailLogText(CLONE_FAIL), /fatal: unable to access/);
  assert.doesNotMatch(setupFailLogText(CLONE_FAIL), /terminal|inspector/i);
});

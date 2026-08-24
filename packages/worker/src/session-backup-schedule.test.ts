import assert from "node:assert/strict";
import test from "node:test";
import { readSessionBackupPolicy, shouldBackupSession } from "./session-backup-schedule.js";

test("readSessionBackupPolicy uses defaults and rejects junk", () => {
  assert.deepEqual(readSessionBackupPolicy({}), { intervalMs: 30_000, everyTools: 5 });
  assert.deepEqual(
    readSessionBackupPolicy({ WORKER_SESSION_BACKUP_INTERVAL_MS: "15000", WORKER_SESSION_BACKUP_EVERY_TOOLS: "3" }),
    { intervalMs: 15_000, everyTools: 3 },
  );
  assert.deepEqual(
    readSessionBackupPolicy({ WORKER_SESSION_BACKUP_INTERVAL_MS: "nope", WORKER_SESSION_BACKUP_EVERY_TOOLS: "-1" }),
    { intervalMs: 30_000, everyTools: 5 },
  );
});

test("shouldBackupSession fires after N tools or the interval while a turn is running", () => {
  const policy = { intervalMs: 30_000, everyTools: 5 };
  assert.equal(
    shouldBackupSession({ now: 10_000, lastBackupAt: 0, toolsSinceBackup: 2, agentRunning: true, policy }),
    false,
  );
  assert.equal(
    shouldBackupSession({ now: 10_000, lastBackupAt: 0, toolsSinceBackup: 5, agentRunning: true, policy }),
    true,
  );
  assert.equal(
    shouldBackupSession({ now: 40_000, lastBackupAt: 5_000, toolsSinceBackup: 1, agentRunning: true, policy }),
    true,
  );
  assert.equal(
    shouldBackupSession({ now: 40_000, lastBackupAt: 5_000, toolsSinceBackup: 1, agentRunning: false, policy }),
    false,
  );
});

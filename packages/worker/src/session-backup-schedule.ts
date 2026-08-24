export type SessionBackupPolicy = {
  intervalMs: number;
  everyTools: number;
};

export function readSessionBackupPolicy(env: NodeJS.ProcessEnv = process.env): SessionBackupPolicy {
  const intervalMs = Number(env.WORKER_SESSION_BACKUP_INTERVAL_MS ?? 30_000);
  const everyTools = Number(env.WORKER_SESSION_BACKUP_EVERY_TOOLS ?? 5);
  return {
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 30_000,
    everyTools: Number.isFinite(everyTools) && everyTools > 0 ? Math.floor(everyTools) : 5,
  };
}

export function shouldBackupSession(input: {
  now: number;
  lastBackupAt: number;
  toolsSinceBackup: number;
  agentRunning: boolean;
  policy: SessionBackupPolicy;
}): boolean {
  if (!input.agentRunning) {
    return false;
  }
  if (input.toolsSinceBackup >= input.policy.everyTools) {
    return true;
  }
  if (input.lastBackupAt <= 0) {
    return false;
  }
  return input.now - input.lastBackupAt >= input.policy.intervalMs;
}

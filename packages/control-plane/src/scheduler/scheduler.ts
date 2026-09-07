import { fireDueAutomations } from "../automations/runner.js";
import { findActiveBuild, listBuilds } from "../env/builds.js";
import { refillWarmPool, warmPoolSize } from "../env/warm-pool.js";
import { startDailyExtractLoop } from "../memory/daily-extract.js";

const WARM_POOL_TICK_MS = 30_000;

export async function refillActiveWarmPools(): Promise<void> {
  if (warmPoolSize() <= 0) {
    return;
  }
  const seen = new Set<string>();
  for (const build of listBuilds()) {
    if (build.status !== "SUCCEEDED" || build.draft || !build.snapshotPath || seen.has(build.fingerprint)) {
      continue;
    }
    const active = findActiveBuild(build.fingerprint);
    if (!active?.snapshotPath) {
      continue;
    }
    seen.add(build.fingerprint);
    await refillWarmPool(active.id, active.snapshotPath);
  }
}

function isTestProcess(): boolean {
  return Boolean(process.env.NODE_TEST_CONTEXT);
}

export function startScheduler(): { stop: () => void } {
  const warmTimer = setInterval(() => {
    void refillActiveWarmPools().catch((error) => console.error("warm pool refill failed", error));
    if (!isTestProcess()) {
      void fireDueAutomations().catch((error) => console.error("automation tick failed", error));
    }
  }, WARM_POOL_TICK_MS);
  warmTimer.unref();
  const memory = isTestProcess() ? { stop() {} } : startDailyExtractLoop();
  return {
    stop: () => {
      clearInterval(warmTimer);
      memory.stop();
    },
  };
}

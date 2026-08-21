import { findActiveBuild, listBuilds } from "../env/builds.js";
import { refillWarmPool, warmPoolSize } from "../env/warm-pool.js";

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

export function startScheduler(): { stop: () => void } {
  const timer = setInterval(() => {
    void refillActiveWarmPools().catch((error) => console.error("warm pool refill failed", error));
  }, 30_000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

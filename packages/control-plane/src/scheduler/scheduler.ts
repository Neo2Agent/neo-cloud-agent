export function startScheduler(): { stop: () => void } {
  const timer = setInterval(() => {
    // P1: expire idle runs, refill the warm pool, enqueue scheduled builds.
  }, 30_000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

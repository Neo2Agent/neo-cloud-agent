import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-warm-"));
process.env.WARM_POOL_SIZE = "2";

const { claimWarmSlot, readyWarmCount, refillWarmPool, resetWarmPoolForTests, warmPoolSize } = await import("./warm-pool.js");
const { refillActiveWarmPools } = await import("../scheduler/scheduler.js");
const { createEnvironmentBuild } = await import("./builds.js");

test("warm pool copies a snapshot and claim renames a ready slot onto the dest", async () => {
  resetWarmPoolForTests();
  const snapshot = mkdtempSync(path.join(tmpdir(), "neo-snap-"));
  writeFileSync(path.join(snapshot, "hello.txt"), "from snapshot\n");
  const buildId = "build-warm-1";
  const slots = await refillWarmPool(buildId, snapshot);
  assert.equal(warmPoolSize(), 2);
  assert.equal(slots.filter((item) => item.ready).length, 2);
  assert.equal(readyWarmCount(buildId), 2);
  assert.ok(slots.every((item) => item.cloneMethod === "copy" || item.cloneMethod === "reflink"));

  const dest = path.join(process.env.RUNS_DIR ?? "", "claimed");
  assert.equal(await claimWarmSlot(buildId, dest), true);
  assert.equal(readFileSync(path.join(dest, "hello.txt"), "utf8"), "from snapshot\n");
  assert.equal(readyWarmCount(buildId), 1);
  assert.equal(existsSync(path.join(process.env.RUNS_DIR ?? "", ".warm", buildId)), true);

  await refillWarmPool(buildId, snapshot);
  assert.equal(readyWarmCount(buildId), 2);
});

test("WARM_POOL_SIZE=0 disables refill", async () => {
  process.env.WARM_POOL_SIZE = "0";
  try {
    resetWarmPoolForTests();
    const snapshot = mkdtempSync(path.join(tmpdir(), "neo-snap0-"));
    writeFileSync(path.join(snapshot, "hello.txt"), "x\n");
    const slots = await refillWarmPool("build-off", snapshot);
    assert.equal(slots.length, 0);
    assert.equal(readyWarmCount("build-off"), 0);
  } finally {
    process.env.WARM_POOL_SIZE = "2";
  }
});

test("scheduler refills ready slots for the active build", async () => {
  process.env.WARM_POOL_SIZE = "1";
  resetWarmPoolForTests();
  const fixture = mkdtempSync(path.join(tmpdir(), "neo-sched-build-"));
  mkdirSync(path.join(fixture, ".neo"), { recursive: true });
  writeFileSync(path.join(fixture, ".neo/environment.json"), JSON.stringify({ install: "printf ok > .neo-installed" }));
  writeFileSync(path.join(fixture, "hello.txt"), "hi\n");
  const build = await createEnvironmentBuild({ repoUrls: [fixture] });
  assert.equal(build.status, "SUCCEEDED");
  const dest = path.join(process.env.RUNS_DIR ?? "", "from-warm");
  assert.equal(await claimWarmSlot(build.id, dest), true);
  assert.equal(readyWarmCount(build.id), 0);
  await refillActiveWarmPools();
  assert.equal(readyWarmCount(build.id), 1);
  process.env.WARM_POOL_SIZE = "2";
});

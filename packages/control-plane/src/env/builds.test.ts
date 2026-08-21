import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "build-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-builds-"));
process.env.WARM_POOL_SIZE = "1";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.BUILD_CAPTURE;

const { environmentFingerprint } = await import("./fingerprint.js");
const {
  canRestoreBuild,
  createEnvironmentBuild,
  findActiveBuild,
  getBuild,
  listBuilds,
  readBuildLogs,
  restoreBuildSnapshot,
} = await import("./builds.js");
const { readyWarmCount, resetWarmPoolForTests } = await import("./warm-pool.js");
const { resetEnvironmentsForTests } = await import("./store.js");

test("environment fingerprint is stable across repo order", () => {
  const a = environmentFingerprint({ repoUrls: ["fixtures/toy-repo", "fixtures/other"], ref: "main" });
  const b = environmentFingerprint({ repoUrls: ["fixtures/other", "fixtures/toy-repo"], ref: "main" });
  const c = environmentFingerprint({ repoUrls: ["fixtures/toy-repo", "fixtures/other"], ref: "dev" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("createEnvironmentBuild snapshots install output and seeds the warm pool", async () => {
  resetEnvironmentsForTests();
  resetWarmPoolForTests();
  const build = await createEnvironmentBuild({
    name: "toy",
    repoUrls: ["fixtures/toy-repo"],
  });
  assert.equal(build.status, "SUCCEEDED");
  assert.equal(build.draft, false);
  assert.ok(build.snapshotPath);
  assert.equal(readFileSync(path.join(build.snapshotPath ?? "", ".neo-installed"), "utf8").trim(), "ok");
  assert.equal(existsSync(path.join(build.snapshotPath ?? "", ".neo-started")), false);
  assert.ok(readBuildLogs(build.id).includes("printf"));
  assert.equal(readyWarmCount(build.id), 1);
  const active = findActiveBuild(build.fingerprint);
  assert.equal(active?.id, build.id);
  assert.equal(canRestoreBuild(active), true);

  const dest = mkdtempSync(path.join(tmpdir(), "neo-restore-"));
  await restoreBuildSnapshot(build, dest);
  assert.equal(readFileSync(path.join(dest, ".neo-installed"), "utf8").trim(), "ok");
  assert.equal(readFileSync(path.join(dest, "hello.txt"), "utf8").includes("toy repo"), true);
});

test("draft builds never become the active boot image", async () => {
  resetEnvironmentsForTests();
  resetWarmPoolForTests();
  const fixture = mkdtempSync(path.join(tmpdir(), "neo-draft-build-"));
  mkdirSync(path.join(fixture, ".neo"), { recursive: true });
  writeFileSync(path.join(fixture, ".neo/environment.json"), JSON.stringify({ install: "printf draft > .neo-installed" }));
  writeFileSync(path.join(fixture, "README.md"), "draft\n");
  const build = await createEnvironmentBuild({
    repoUrls: [fixture],
    draft: true,
  });
  assert.equal(build.status, "SUCCEEDED");
  assert.equal(build.draft, true);
  assert.equal(findActiveBuild(build.fingerprint), undefined);
  assert.equal(readyWarmCount(build.id), 0);
  assert.equal(getBuild(build.id)?.id, build.id);
  assert.equal(listBuilds().some((item) => item.id === build.id), true);
});

test("failed install marks the build FAILED", async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "neo-build-fail-"));
  mkdirSync(path.join(fixture, ".neo"), { recursive: true });
  writeFileSync(path.join(fixture, ".neo/environment.json"), JSON.stringify({ install: "exit 9" }));
  writeFileSync(path.join(fixture, "README.md"), "x\n");
  const build = await createEnvironmentBuild({ repoUrls: [fixture] });
  assert.equal(build.status, "FAILED");
  assert.match(build.failureMessage ?? "", /exited 9|FAILED/i);
  assert.equal(canRestoreBuild(build), false);
  assert.match(readBuildLogs(build.id), /FAILED/);
});

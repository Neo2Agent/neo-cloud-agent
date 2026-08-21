import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-rootfs-"));

const {
  ensureFirecrackerRootfs,
  isProductionRootfs,
  materializeRootfsOverlay,
  packRootfsImage,
  productionFirecrackerPaths,
  rootfsOverlayFiles,
} = await import("./rootfs.js");

const boot = fileURLToPath(new URL("../../../../infra/firecracker/boot.sh", import.meta.url));

test("rootfs overlay writes guest PID 1 and the worker start helper", () => {
  const dest = mkdtempSync(path.join(tmpdir(), "neo-overlay-"));
  const written = materializeRootfsOverlay(dest);
  assert.deepEqual(written.sort(), ["opt/neo/boot.sh", "opt/neo/worker/start.sh", "sbin/init"].sort());
  assert.equal(statSync(path.join(dest, "sbin/init")).mode & 0o111, 0o111);
  assert.match(readFileSync(path.join(dest, "opt/neo/boot.sh"), "utf8"), /run-bootstrap\.json/);
  assert.match(readFileSync(path.join(dest, "opt/neo/worker/start.sh"), "utf8"), /tsx/);
  assert.match(readFileSync(path.join(dest, "sbin/init"), "utf8"), /\/opt\/neo\/boot\.sh/);
  assert.equal(rootfsOverlayFiles().length, 3);
});

test("production rootfs helper rejects the tiny overlay image", () => {
  const tiny = path.join(process.env.RUNS_DIR ?? tmpdir(), "tiny.ext4");
  writeFileSync(tiny, "overlay");
  assert.equal(isProductionRootfs(tiny), false);
  assert.match(productionFirecrackerPaths().rootfs, /rootfs\.ext4$/);
});

test("boot.sh in dry-run starts a workspace worker entry", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "neo-guest-"));
  mkdirSync(path.join(workspace, ".neo"), { recursive: true });
  writeFileSync(
    path.join(workspace, ".neo/run-bootstrap.json"),
    JSON.stringify({
      runId: "run-guest-1",
      jwt: "jwt-guest",
      controlPlaneUrl: "http://cp",
      llmGatewayUrl: "http://llm",
      model: "neo/deepseek",
      workspaceDir: workspace,
    }),
  );
  writeFileSync(
    path.join(workspace, ".neo/worker-entry.mjs"),
    `import { writeFileSync } from "node:fs";
writeFileSync(\`\${process.env.WORKSPACE_DIR}/worker-started\`, process.env.RUN_ID ?? "");
`,
  );
  chmodSync(path.join(workspace, ".neo/worker-entry.mjs"), 0o644);
  const result = spawnSync("sh", [boot], {
    env: { ...process.env, NEO_DRY_RUN: "1", NEO_WORKSPACE: workspace, PATH: process.env.PATH ?? "/usr/bin" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readFileSync(path.join(workspace, "worker-started"), "utf8"), "run-guest-1");
});

test("ensureFirecrackerRootfs materializes an overlay and packs ext4 when mkfs exists", async () => {
  const overlay = path.join(process.env.RUNS_DIR ?? "", "overlay-pack");
  materializeRootfsOverlay(overlay);
  const mkfs = spawnSync("mkfs.ext4", ["-V"], { encoding: "utf8" });
  if (mkfs.error) {
    const packed = await packRootfsImage(overlay, path.join(process.env.RUNS_DIR ?? "", "missing.ext4"), 16);
    assert.equal(packed, false);
    return;
  }
  const image = path.join(process.env.RUNS_DIR ?? "", "rootfs.ext4");
  assert.equal(await packRootfsImage(overlay, image, 16), true);
  assert.equal(existsSync(image), true);
  assert.ok(statSync(image).size >= 16 * 1024 * 1024);
  const ensured = await ensureFirecrackerRootfs();
  assert.ok(ensured);
  assert.equal(existsSync(ensured ?? ""), true);
});

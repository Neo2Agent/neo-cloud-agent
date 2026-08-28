import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { hostWorkspaceFor } from "../worker-spawn.js";
import { persistRunWorkspace } from "./persist-workspace.js";
import {
  claimVmSlot,
  ensureVmSlots,
  resetVmSlotsForTests,
} from "./vm-slots.js";
import { loadWorkspaceMeta } from "./workspace-store.js";

test("persistRunWorkspace copies a skip-mount slot onto the host run dir", async () => {
  const slotsDir = mkdtempSync(path.join(tmpdir(), "neo-persist-slots-"));
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-persist-runs-"));
  const previous = {
    VM_SLOTS_DIR: process.env.VM_SLOTS_DIR,
    VM_SLOT_COUNT: process.env.VM_SLOT_COUNT,
    VM_SLOT_SKIP_MOUNT: process.env.VM_SLOT_SKIP_MOUNT,
    RUNS_DIR: process.env.RUNS_DIR,
    HOST_RUNS_DIR: process.env.HOST_RUNS_DIR,
    WORKER_RUNTIME: process.env.WORKER_RUNTIME,
    WORKER_DISK_GIB: process.env.WORKER_DISK_GIB,
  };
  process.env.VM_SLOTS_DIR = slotsDir;
  process.env.VM_SLOT_COUNT = "1";
  process.env.VM_SLOT_SKIP_MOUNT = "1";
  process.env.RUNS_DIR = runsDir;
  process.env.HOST_RUNS_DIR = runsDir;
  process.env.WORKER_RUNTIME = "vm";
  process.env.WORKER_DISK_GIB = "1";
  resetVmSlotsForTests();
  try {
    await ensureVmSlots();
    const slot = await claimVmSlot("run-persist");
    mkdirSync(path.join(slot.mountPath, "node_modules"), { recursive: true });
    writeFileSync(path.join(slot.mountPath, "node_modules", "x.js"), "cache\n");
    writeFileSync(path.join(slot.mountPath, "USER.md"), "from slot\n");
    const result = await persistRunWorkspace("run-persist");
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.persisted, true);
    const dest = hostWorkspaceFor("run-persist");
    assert.equal(readFileSync(path.join(dest, "USER.md"), "utf8"), "from slot\n");
    assert.equal(loadWorkspaceMeta("run-persist")?.state, "present");
    assert.equal(existsSync(path.join(dest, "node_modules")), false);
  } finally {
    resetVmSlotsForTests();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultWorkerResources } from "../config.js";
import {
  claimVmSlot,
  ensureVmSlots,
  listVmSlots,
  reconcileOrphanVmSlots,
  releaseVmSlot,
  resetVmSlotsForTests,
  summarizeVmSlots,
  vmSlotCount,
} from "./vm-slots.js";

test("small hosts default to 1 vCPU / 512MiB / 4GiB for vm and firecracker", () => {
  const previous = {
    WORKER_CPUS: process.env.WORKER_CPUS,
    WORKER_MEMORY_MIB: process.env.WORKER_MEMORY_MIB,
    WORKER_DISK_GIB: process.env.WORKER_DISK_GIB,
  };
  delete process.env.WORKER_CPUS;
  delete process.env.WORKER_MEMORY_MIB;
  delete process.env.WORKER_DISK_GIB;
  try {
    assert.deepEqual(defaultWorkerResources("vm"), { cpu: 1, memoryMiB: 512, diskGiB: 4 });
    assert.deepEqual(defaultWorkerResources("firecracker"), { cpu: 1, memoryMiB: 512, diskGiB: 4 });
    assert.deepEqual(defaultWorkerResources("local"), { cpu: 2, memoryMiB: 2048, diskGiB: 40 });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("vm slots cap concurrent mounts and reuse after release", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-vm-slots-"));
  const previous = {
    VM_SLOTS_DIR: process.env.VM_SLOTS_DIR,
    VM_SLOT_COUNT: process.env.VM_SLOT_COUNT,
    VM_SLOT_SKIP_MOUNT: process.env.VM_SLOT_SKIP_MOUNT,
    WORKER_DISK_GIB: process.env.WORKER_DISK_GIB,
    WORKER_RUNTIME: process.env.WORKER_RUNTIME,
  };
  process.env.VM_SLOTS_DIR = dir;
  process.env.VM_SLOT_COUNT = "2";
  process.env.VM_SLOT_SKIP_MOUNT = "1";
  process.env.WORKER_DISK_GIB = "4";
  process.env.WORKER_RUNTIME = "vm";
  resetVmSlotsForTests();
  try {
    assert.equal(vmSlotCount(), 2);
    await ensureVmSlots();
    assert.equal(listVmSlots().length, 2);
    const first = await claimVmSlot("run-a");
    const second = await claimVmSlot("run-b");
    assert.equal(first.id, "slot-0");
    assert.equal(second.id, "slot-1");
    assert.match(readFileSync(path.join(first.mountPath, ".neo-slot"), "utf8"), /slot-0/);
    await assert.rejects(claimVmSlot("run-c"), /all VM slots are busy/);
    const summary = summarizeVmSlots("vm");
    assert.equal(summary.total, 2);
    assert.equal(summary.busy, 2);
    assert.equal(summary.backend, "loop");
    await releaseVmSlot("run-a");
    const third = await claimVmSlot("run-c");
    assert.equal(third.id, "slot-0");
    assert.equal(third.runId, "run-c");
    assert.equal(summarizeVmSlots("vm").busy, 2);
    const orphans = await reconcileOrphanVmSlots((runId) => runId === "run-c");
    assert.ok(orphans.includes("slot-1"));
    assert.equal(summarizeVmSlots("vm").busy, 1);
    assert.equal(listVmSlots().find((item) => item.id === "slot-1")?.status, "idle");
    assert.equal(listVmSlots().find((item) => item.id === "slot-0")?.runId, "run-c");
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

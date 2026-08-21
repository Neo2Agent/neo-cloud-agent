import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { firecrackerReady } from "./firecracker.js";

function repoRoot(): string {
  return fileURLToPath(new URL("../../../..", import.meta.url));
}

export type VmSlotStatus = "idle" | "busy";
export type VmSlotBackend = "kvm" | "loop" | "none";

export interface VmSlot {
  id: string;
  status: VmSlotStatus;
  runId: string | null;
  imagePath: string;
  mountPath: string;
  sizeGiB: number;
  mounted: boolean;
}

export interface VmSlotSummary {
  runtime: string;
  kvm: boolean;
  backend: VmSlotBackend;
  total: number;
  busy: number;
  sizeGiB: number;
  slots: Array<{
    id: string;
    status: VmSlotStatus;
    runId: string | null;
    sizeGiB: number;
    mounted: boolean;
  }>;
}

export type VmSlotRunner = (command: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const slots = new Map<string, VmSlot>();
let runner: VmSlotRunner = defaultRunner;

export function setVmSlotRunnerForTests(next?: VmSlotRunner): void {
  runner = next ?? defaultRunner;
}

export function resetVmSlotsForTests(): void {
  slots.clear();
  runner = defaultRunner;
}

export function vmSlotCount(): number {
  const raw = Number(process.env.VM_SLOT_COUNT ?? 2);
  if (!Number.isFinite(raw)) {
    return 2;
  }
  return Math.min(4, Math.max(1, Math.floor(raw)));
}

export function vmSlotSizeGiB(): number {
  const raw = Number(process.env.WORKER_DISK_GIB ?? process.env.VM_SLOT_SIZE_GIB ?? 4);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 4;
  }
  return Math.min(16, Math.floor(raw));
}

export function vmSlotsDir(): string {
  return process.env.VM_SLOTS_DIR ?? path.join(repoRoot(), ".neo/vms");
}

export function kvmAvailable(): boolean {
  return existsSync("/dev/kvm");
}

export function vmSlotBackend(runtime = process.env.WORKER_RUNTIME ?? "local"): VmSlotBackend {
  if (runtime === "firecracker" || runtime === "vm") {
    if (firecrackerReady()) {
      return "kvm";
    }
    return runtime === "vm" ? "loop" : "none";
  }
  return "none";
}

function skipMount(): boolean {
  return process.env.VM_SLOT_SKIP_MOUNT === "1" || process.env.VM_SLOT_SKIP_MOUNT === "true";
}

function skipFormat(): boolean {
  return skipMount() || process.env.VM_SLOT_SKIP_FORMAT === "1";
}

function defaultRunner(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function runNet(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const direct = await runner(command, args).catch((error) => ({
    code: 127,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  }));
  if (direct.code === 0) {
    return direct;
  }
  return runner("sudo", ["-n", command, ...args]).catch((error) => ({
    code: 127,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  }));
}

async function ensureSparseImage(file: string, sizeGiB: number): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file) && statSync(file).size > 0) {
    return;
  }
  const handle = await open(file, "w");
  try {
    await handle.truncate(Math.max(1, sizeGiB) * 1024 * 1024 * 1024);
  } finally {
    await handle.close();
  }
  if (skipFormat()) {
    return;
  }
  const mkfs = await runNet("mkfs.ext4", ["-F", "-q", file]);
  if (mkfs.code !== 0) {
    throw new Error(`failed to format VM slot image ${file}: ${mkfs.stderr || mkfs.stdout || `exit ${mkfs.code}`}`);
  }
}

export async function ensureVmSlots(): Promise<VmSlot[]> {
  const dir = vmSlotsDir();
  const sizeGiB = vmSlotSizeGiB();
  const count = vmSlotCount();
  mkdirSync(path.join(dir, "mnt"), { recursive: true });
  const ensured: VmSlot[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `slot-${i}`;
    const imagePath = path.join(dir, `${id}.ext4`);
    const mountPath = path.join(dir, "mnt", id);
    mkdirSync(mountPath, { recursive: true });
    await ensureSparseImage(imagePath, sizeGiB);
    const existing = slots.get(id);
    const slot: VmSlot = existing ?? {
      id,
      status: "idle",
      runId: null,
      imagePath,
      mountPath,
      sizeGiB,
      mounted: false,
    };
    slot.imagePath = imagePath;
    slot.mountPath = mountPath;
    slot.sizeGiB = sizeGiB;
    slots.set(id, slot);
    ensured.push(slot);
  }
  return ensured;
}

export function listVmSlots(): VmSlot[] {
  return [...slots.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function summarizeVmSlots(runtime = process.env.WORKER_RUNTIME ?? "local"): VmSlotSummary {
  const all = listVmSlots();
  const backend = vmSlotBackend(runtime);
  const total = runtime === "vm" || runtime === "firecracker" ? Math.max(all.length, vmSlotCount()) : all.length;
  return {
    runtime,
    kvm: kvmAvailable(),
    backend,
    total,
    busy: all.filter((slot) => slot.status === "busy").length,
    sizeGiB: vmSlotSizeGiB(),
    slots: all.map((slot) => ({
      id: slot.id,
      status: slot.status,
      runId: slot.runId,
      sizeGiB: slot.sizeGiB,
      mounted: slot.mounted,
    })),
  };
}

export async function claimVmSlot(runId: string): Promise<VmSlot> {
  if (slots.size === 0) {
    await ensureVmSlots();
  }
  const already = listVmSlots().find((slot) => slot.runId === runId);
  if (already) {
    return already;
  }
  const idle = listVmSlots().find((slot) => slot.status === "idle");
  if (!idle) {
    throw new Error(`all VM slots are busy (${vmSlotCount()}/${vmSlotCount()})`);
  }
  idle.status = "busy";
  idle.runId = runId;
  if (!skipMount()) {
    await mountVmSlot(idle);
  } else {
    mkdirSync(idle.mountPath, { recursive: true });
    writeFileSync(path.join(idle.mountPath, ".neo-slot"), `${idle.id}\n`);
  }
  return idle;
}

export async function releaseVmSlot(runId: string): Promise<void> {
  const slot = listVmSlots().find((item) => item.runId === runId);
  if (!slot) {
    return;
  }
  if (slot.mounted && !skipMount()) {
    await unmountVmSlot(slot);
  }
  if (skipMount()) {
    rmSync(slot.mountPath, { recursive: true, force: true });
    mkdirSync(slot.mountPath, { recursive: true });
  }
  slot.status = "idle";
  slot.runId = null;
  slot.mounted = false;
}

async function mountVmSlot(slot: VmSlot): Promise<void> {
  mkdirSync(slot.mountPath, { recursive: true });
  const result = await runNet("mount", ["-o", "loop,rw", slot.imagePath, slot.mountPath]);
  if (result.code !== 0 && !/already mounted|busy/i.test(result.stderr + result.stdout)) {
    throw new Error(`failed to mount VM slot ${slot.id}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
  await runNet("chown", ["-R", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, slot.mountPath]).catch(
    () => undefined,
  );
  slot.mounted = true;
}

async function unmountVmSlot(slot: VmSlot): Promise<void> {
  const result = await runNet("umount", [slot.mountPath]);
  if (result.code !== 0 && !/not mounted|no mount/i.test(result.stderr + result.stdout)) {
    await runNet("umount", ["-l", slot.mountPath]);
  }
  slot.mounted = false;
}

export function vmWorkspaceFor(runId: string): string | null {
  const slot = listVmSlots().find((item) => item.runId === runId);
  return slot ? slot.mountPath : null;
}

export async function resetMountedVmSlots(): Promise<void> {
  for (const slot of listVmSlots()) {
    if (slot.runId) {
      await releaseVmSlot(slot.runId).catch(() => undefined);
    }
  }
}

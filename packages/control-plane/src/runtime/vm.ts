import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { ExecutionRuntime, RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";
import type { WorkerLease } from "../store/persist.js";
import { copyWorkspaceTree } from "../scm/workspace.js";
import type { RuntimeHooks } from "./docker.js";
import { firecrackerReady, FirecrackerRuntime } from "./firecracker.js";
import { LocalProcessRuntime } from "./local.js";
import { persistRunWorkspace } from "./persist-workspace.js";
import { claimVmSlot, releaseVmSlot, type VmSlot } from "./vm-slots.js";

function wipeMount(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  for (const entry of readdirSync(dir)) {
    if (entry === "lost+found") {
      continue;
    }
    rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function preferKvm(): boolean {
  return firecrackerReady();
}

async function persistAndRelease(runId: string): Promise<void> {
  try {
    await persistRunWorkspace(runId);
  } catch (error) {
    console.error(`failed to persist VM workspace for ${runId}`, error);
  }
  await releaseVmSlot(runId);
}

export class VmSlotRuntime implements ExecutionRuntime {
  private readonly local = new LocalProcessRuntime();
  private readonly firecracker = new FirecrackerRuntime();
  private readonly slots = new Map<string, VmSlot>();

  async provision(spec: RuntimeSpec, hooks?: RuntimeHooks): Promise<RuntimeHandle> {
    const slot = await claimVmSlot(spec.runId);
    this.slots.set(spec.runId, slot);
    try {
      if (preferKvm()) {
        const handle = await this.firecracker.provision(
          { ...spec, diskGiB: spec.diskGiB || slot.sizeGiB },
          hooks,
        );
        return { ...handle, runtime: "vm", slotId: slot.id };
      }
      wipeMount(slot.mountPath);
      if (existsSync(spec.hostWorkspaceDir) && readdirSync(spec.hostWorkspaceDir).length > 0) {
        await copyWorkspaceTree(spec.hostWorkspaceDir, slot.mountPath);
      }
      const handle = await this.local.provision(
        { ...spec, hostWorkspaceDir: slot.mountPath, hostWorkspaceBind: slot.mountPath },
        {
          onLog: hooks?.onLog,
          onExit: (code) => {
            void persistAndRelease(spec.runId).then(() => {
              this.slots.delete(spec.runId);
              hooks?.onExit?.(code);
            });
          },
        },
      );
      hooks?.onLog?.(
        `vm slot ${slot.id} mounted at ${slot.mountPath} (loop, no /dev/kvm on this host)\n`,
      );
      return {
        ...handle,
        id: `vm-${spec.runId}`,
        runtime: "vm",
        slotId: slot.id,
      };
    } catch (error) {
      await releaseVmSlot(spec.runId).catch(() => undefined);
      this.slots.delete(spec.runId);
      throw error;
    }
  }

  async adopt(runId: string, lease: WorkerLease | null, hooks?: RuntimeHooks): Promise<RuntimeHandle | null> {
    const handle = await this.local.adopt(runId, lease, {
      onLog: hooks?.onLog,
      onExit: (code) => {
        void persistAndRelease(runId).then(() => {
          this.slots.delete(runId);
          hooks?.onExit?.(code);
        });
      },
    });
    if (!handle) {
      return this.firecracker.adopt(runId, lease, hooks);
    }
    return { ...handle, id: lease?.handleId ?? `vm-${runId}`, runtime: "vm" };
  }

  async snapshot(handle: RuntimeHandle): Promise<string> {
    return `snap-${handle.id}`;
  }

  async restore(snapshotId: string, spec: RuntimeSpec): Promise<RuntimeHandle> {
    return { id: `vm-${spec.runId}-from-${snapshotId}`, runtime: "vm", ip: null };
  }

  async destroy(handle: RuntimeHandle): Promise<void> {
    const runId = handle.id.startsWith("vm-") ? handle.id.slice("vm-".length) : handle.id;
    try {
      if (handle.socket) {
        await this.firecracker.destroy({ ...handle, id: `fc-${runId}` });
      } else {
        await this.local.destroy({ ...handle, id: `local-${runId}` });
      }
    } finally {
      await persistAndRelease(runId);
      this.slots.delete(runId);
    }
  }
}

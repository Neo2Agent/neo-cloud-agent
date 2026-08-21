/** How a Build snapshot or Firecracker disk was materialized for a Run. */
export type DiskCloneMethod = "reflink" | "copy" | "shared" | "rename";

export type DiskKind = "workspace" | "rootfs";

export interface DiskCloneResult {
  method: DiskCloneMethod;
  dest: string;
  kind: DiskKind;
}

/** Captured disk image. Interface for later block-level snapshots; not live-fork. */
export interface DiskSnapshot {
  id: string;
  kind: DiskKind;
  path: string;
}

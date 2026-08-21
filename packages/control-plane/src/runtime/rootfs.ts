import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "../config.js";

function firecrackerDir(): string {
  return fileURLToPath(new URL("../../../../infra/firecracker", import.meta.url));
}

export function rootfsOverlayFiles(): Array<{ dest: string; mode: number; source?: string; contents?: string }> {
  const root = firecrackerDir();
  return [
    { dest: "opt/neo/boot.sh", mode: 0o755, source: path.join(root, "boot.sh") },
    { dest: "opt/neo/worker/start.sh", mode: 0o755, source: path.join(root, "start-worker.sh") },
    { dest: "sbin/init", mode: 0o755, source: path.join(root, "init") },
  ];
}

export function materializeRootfsOverlay(dest: string): string[] {
  mkdirSync(dest, { recursive: true });
  const written: string[] = [];
  for (const file of rootfsOverlayFiles()) {
    const target = path.join(dest, file.dest);
    mkdirSync(path.dirname(target), { recursive: true });
    const body = file.contents ?? readFileSync(file.source ?? "", "utf8");
    writeFileSync(target, body);
    chmodSync(target, file.mode);
    written.push(file.dest);
  }
  return written;
}

export async function packRootfsImage(overlayDir: string, imagePath: string, sizeMiB = 256): Promise<boolean> {
  mkdirSync(path.dirname(imagePath), { recursive: true });
  const handle = await open(imagePath, "w");
  try {
    await handle.truncate(sizeMiB * 1024 * 1024);
  } finally {
    await handle.close();
  }
  const { spawn } = await import("node:child_process");
  const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
    const child = spawn("mkfs.ext4", ["-F", "-d", overlayDir, imagePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", () => resolve({ code: 127, stderr: "mkfs.ext4 missing" }));
    child.on("exit", (code) => resolve({ code: code ?? 1, stderr }));
  });
  return result.code === 0;
}

export async function ensureFirecrackerRootfs(): Promise<string | null> {
  const configured = (process.env.FIRECRACKER_ROOTFS ?? "").trim();
  if (configured && existsSync(configured)) {
    return configured;
  }
  const overlay = path.join(getConfig().runsDir, ".firecracker", "overlay");
  materializeRootfsOverlay(overlay);
  const image = path.join(getConfig().runsDir, ".firecracker", "rootfs.ext4");
  if (existsSync(image)) {
    return image;
  }
  if (await packRootfsImage(overlay, image)) {
    return image;
  }
  return existsSync(overlay) ? overlay : null;
}

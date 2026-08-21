import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { access, open, unlink } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { ExecutionRuntime, RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";
import type { WorkerLease } from "../store/persist.js";
import type { RuntimeHooks } from "./docker.js";
import { ensureFirecrackerRootfs } from "./rootfs.js";

export type FirecrackerHttp = (
  socketPath: string,
  method: string,
  urlPath: string,
  body?: unknown,
) => Promise<{ status: number; text: string }>;

export type FirecrackerProcessRunner = (command: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export type FirecrackerOptions = {
  bin?: string;
  kernel?: string;
  rootfs?: string;
  net?: "tap" | "none";
  request?: FirecrackerHttp;
  runCommand?: FirecrackerProcessRunner;
  spawnProcess?: (bin: string, args: string[], sock: string) => Promise<{ pid: number | null; stop: () => void }>;
  waitForSocket?: (sock: string, timeoutMs?: number) => Promise<void>;
  now?: () => number;
};

export type FirecrackerCall = {
  method: string;
  path: string;
  body?: unknown;
};

export type TapPlan = {
  name: string;
  hostIp: string;
  guestIp: string;
  prefix: 30;
  guestMac: string;
};

function hash16(value: string): number {
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt16BE(0);
}

export function tapPlan(runId: string): TapPlan {
  const n = hash16(runId);
  const block = 16 + (n % 200);
  const host = 1 + ((n >> 8) % 2) * 4;
  const hex = runId.replaceAll("-", "").slice(0, 8).padEnd(8, "0");
  return {
    name: `nca${hex}`.slice(0, 15),
    hostIp: `172.${block}.${Math.floor(n / 256) % 200}.${host}`,
    guestIp: `172.${block}.${Math.floor(n / 256) % 200}.${host + 1}`,
    prefix: 30,
    guestMac: `AA:FC:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}`.toUpperCase(),
  };
}

export function guestCid(runId: string): number {
  return 100 + (hash16(runId) % 20_000);
}

export function firecrackerPaths(spec: RuntimeSpec): {
  runDir: string;
  sock: string;
  log: string;
  vsock: string;
  workspaceImg: string;
  bootstrapFile: string;
} {
  const runDir = path.join(spec.hostWorkspaceDir, ".neo", "firecracker");
  return {
    runDir,
    sock: path.join(runDir, "firecracker.sock"),
    log: path.join(runDir, "firecracker.log"),
    vsock: path.join(runDir, "vsock.sock"),
    workspaceImg: path.join(runDir, "workspace.ext4"),
    bootstrapFile: path.join(spec.hostWorkspaceDir, ".neo", "run-bootstrap.json"),
  };
}

export function writeRunBootstrap(spec: RuntimeSpec): string {
  const dest = firecrackerPaths(spec).bootstrapFile;
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(
    dest,
    `${JSON.stringify(
      {
        runId: spec.runId,
        jwt: spec.jwt,
        controlPlaneUrl: spec.controlPlaneUrl,
        llmGatewayUrl: spec.llmGatewayUrl,
        model: spec.model,
        workspaceDir: spec.workspaceMount,
        egress: spec.egress,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return dest;
}

export function buildFirecrackerCalls(
  spec: RuntimeSpec,
  paths: { kernel: string; rootfs: string; workspaceImg: string; vsock: string },
  tap?: TapPlan | null,
): FirecrackerCall[] {
  const cid = guestCid(spec.runId);
  const bootArgs = [
    "console=ttyS0",
    "reboot=k",
    "panic=1",
    "pci=off",
    "init=/sbin/init",
    `neo_run_id=${spec.runId}`,
  ];
  if (tap) {
    bootArgs.push(`ip=${tap.guestIp}::${tap.hostIp}:255.255.255.252::eth0:off`);
  }
  const calls: FirecrackerCall[] = [
    {
      method: "PUT",
      path: "/machine-config",
      body: { vcpu_count: Math.max(1, spec.cpu), mem_size_mib: Math.max(128, spec.memoryMiB), smt: false },
    },
    {
      method: "PUT",
      path: "/boot-source",
      body: { kernel_image_path: paths.kernel, boot_args: bootArgs.join(" ") },
    },
    {
      method: "PUT",
      path: "/drives/root",
      body: { drive_id: "root", path_on_host: paths.rootfs, is_root_device: true, is_read_only: true },
    },
    {
      method: "PUT",
      path: "/drives/workspace",
      body: { drive_id: "workspace", path_on_host: paths.workspaceImg, is_root_device: false, is_read_only: false },
    },
    {
      method: "PUT",
      path: "/vsock",
      body: { guest_cid: cid, uds_path: paths.vsock },
    },
  ];
  if (tap) {
    calls.push({
      method: "PUT",
      path: "/network-interfaces/eth0",
      body: { iface_id: "eth0", guest_mac: tap.guestMac, host_dev_name: tap.name },
    });
  }
  calls.push({ method: "PUT", path: "/actions", body: { action_type: "InstanceStart" } });
  return calls;
}

export function requestUnix(
  socketPath: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = http.request(
      {
        socketPath,
        path: urlPath,
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function waitForPath(file: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`firecracker api socket not ready: ${file}`);
}

function spawnFirecracker(bin: string, args: string[]): Promise<{ pid: number | null; stop: () => void; child: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.once("error", reject);
    const stop = () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    };
    resolve({ pid: child.pid ?? null, stop, child });
  });
}

function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
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

async function ensureSparseFile(file: string, sizeGiB: number): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true });
  const handle = await open(file, "w");
  try {
    await handle.truncate(Math.max(1, sizeGiB) * 1024 * 1024 * 1024);
  } finally {
    await handle.close();
  }
}

async function packWorkspaceImage(srcDir: string, destImg: string, sizeGiB: number, run: FirecrackerProcessRunner): Promise<void> {
  await ensureSparseFile(destImg, sizeGiB);
  const mkfs = await run("mkfs.ext4", ["-F", "-d", srcDir, destImg]).catch(() => ({ code: 1, stdout: "", stderr: "mkfs.ext4 missing" }));
  if (mkfs.code !== 0) {
    console.warn(`firecracker workspace image is sparse-only (${mkfs.stderr.trim() || "mkfs.ext4 failed"}); guest needs a rootfs that can mount it`);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class FirecrackerRuntime implements ExecutionRuntime {
  private readonly children = new Map<string, { stop: () => void; tap?: TapPlan }>();
  private readonly options: FirecrackerOptions;

  constructor(options: FirecrackerOptions = {}) {
    this.options = options;
  }

  async provision(spec: RuntimeSpec, hooks?: RuntimeHooks): Promise<RuntimeHandle> {
    const kernel = this.options.kernel || process.env.FIRECRACKER_KERNEL || "";
    let rootfs = this.options.rootfs || process.env.FIRECRACKER_ROOTFS || "";
    if (!rootfs) {
      const packed = await ensureFirecrackerRootfs();
      if (packed && existsSync(packed) && statSync(packed).isFile()) {
        rootfs = packed;
      }
    }
    const bin = this.options.bin || process.env.FIRECRACKER_BIN || "firecracker";
    if (!kernel || !rootfs) {
      throw new Error("FIRECRACKER_KERNEL and FIRECRACKER_ROOTFS are required for WORKER_RUNTIME=firecracker");
    }
    await access(kernel);
    await access(rootfs);
    writeRunBootstrap(spec);
    const paths = firecrackerPaths(spec);
    mkdirSync(paths.runDir, { recursive: true });
    if (existsSync(paths.sock)) {
      await unlink(paths.sock).catch(() => undefined);
    }
    const run = this.options.runCommand ?? runCommand;
    await packWorkspaceImage(spec.hostWorkspaceDir, paths.workspaceImg, spec.diskGiB || 8, run);

    const net = this.options.net ?? (process.env.FIRECRACKER_NET === "none" ? "none" : "tap");
    const tap = net === "tap" ? tapPlan(spec.runId) : null;
    if (tap) {
      await this.setupTap(tap, spec.controlPlaneUrl, run);
    }

    const spawned =
      (await this.options.spawnProcess?.(bin, ["--api-sock", paths.sock, "--id", spec.runId.slice(0, 8)], paths.sock)) ??
      (await spawnFirecracker(bin, ["--api-sock", paths.sock, "--id", spec.runId.slice(0, 8)]));
    await (this.options.waitForSocket ?? waitForPath)(paths.sock);
    const request = this.options.request ?? requestUnix;
    const calls = buildFirecrackerCalls(spec, { kernel, rootfs, workspaceImg: paths.workspaceImg, vsock: paths.vsock }, tap);
    for (const call of calls) {
      const result = await request(paths.sock, call.method, call.path, call.body);
      if (result.status >= 300) {
        spawned.stop();
        throw new Error(`firecracker ${call.method} ${call.path} failed: ${result.status} ${result.text}`.trim());
      }
    }
    this.children.set(spec.runId, { stop: spawned.stop, tap: tap ?? undefined });
    hooks?.onLog?.(`firecracker ${spec.runId} cid=${guestCid(spec.runId)} ip=${tap?.guestIp ?? "none"}\n`);
    return {
      id: `fc-${spec.runId}`,
      runtime: "firecracker",
      ip: tap?.guestIp ?? null,
      pid: spawned.pid,
      socket: paths.sock,
      cid: guestCid(spec.runId),
    };
  }

  async snapshot(handle: RuntimeHandle): Promise<string> {
    return `snap-${handle.id}`;
  }

  async restore(snapshotId: string, spec: RuntimeSpec): Promise<RuntimeHandle> {
    return { id: `fc-${spec.runId}-from-${snapshotId}`, runtime: "firecracker", ip: null };
  }

  async destroy(handle: RuntimeHandle): Promise<void> {
    const runId = handle.id.startsWith("fc-") ? handle.id.slice("fc-".length) : handle.id;
    const child = this.children.get(runId);
    if (handle.socket) {
      try {
        await (this.options.request ?? requestUnix)(handle.socket, "PUT", "/actions", { action_type: "SendCtrlAltDel" });
      } catch {
        // process may already be gone
      }
    }
    child?.stop();
    if (!child && handle.pid && alive(handle.pid)) {
      try {
        process.kill(handle.pid, "SIGTERM");
      } catch {
        // gone
      }
    }
    if (child?.tap) {
      await this.teardownTap(child.tap);
    }
    this.children.delete(runId);
  }

  async adopt(runId: string, lease: WorkerLease | null, hooks?: RuntimeHooks): Promise<RuntimeHandle | null> {
    const pid = lease?.pid;
    const socket = lease?.socket;
    if (!pid || !alive(pid) || !socket || !existsSync(socket)) {
      return null;
    }
    const timer = setInterval(() => {
      if (alive(pid) && existsSync(socket)) {
        return;
      }
      clearInterval(timer);
      hooks?.onExit?.(null);
    }, 1000);
    timer.unref();
    this.children.set(runId, {
      stop: () => {
        clearInterval(timer);
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // gone
        }
      },
    });
    return {
      id: lease.handleId ?? `fc-${runId}`,
      runtime: "firecracker",
      ip: null,
      pid,
      socket,
      cid: lease.cid ?? guestCid(runId),
    };
  }

  private async setupTap(tap: TapPlan, controlPlaneUrl: string, run: FirecrackerProcessRunner): Promise<void> {
    const commands: Array<[string, string[]]> = [
      ["ip", ["tuntap", "add", "dev", tap.name, "mode", "tap"]],
      ["ip", ["addr", "add", `${tap.hostIp}/${tap.prefix}`, "dev", tap.name]],
      ["ip", ["link", "set", tap.name, "up"]],
    ];
    for (const [command, args] of commands) {
      const result = await run(command, args);
      if (result.code !== 0 && !/exists|file exists/i.test(result.stderr)) {
        throw new Error(`failed to configure tap ${tap.name}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
      }
    }
    void controlPlaneUrl;
  }

  private async teardownTap(tap: TapPlan): Promise<void> {
    const run = this.options.runCommand ?? runCommand;
    await run("ip", ["link", "delete", tap.name]).catch(() => undefined);
  }
}

export function firecrackerAvailable(bin = process.env.FIRECRACKER_BIN ?? "firecracker"): boolean {
  return existsSync("/dev/kvm") && (bin.includes("/") ? existsSync(bin) : true);
}

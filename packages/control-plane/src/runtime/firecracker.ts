import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, mkdirSync, openSync, rmSync, statSync, writeFileSync } from "node:fs";
import { access, open, unlink } from "node:fs/promises";
import http from "node:http";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import type { ExecutionRuntime, RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";
import type { WorkerLease } from "../store/persist.js";
import type { RuntimeHooks } from "./docker.js";
import {
  ensureFirecrackerRootfs,
  firecrackerAssetsDir,
  isProductionRootfs,
  productionFirecrackerPaths,
} from "./rootfs.js";
import { copyWorkspaceTree } from "../scm/workspace.js";

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

type ChildState = {
  stop: () => void;
  tap?: TapPlan;
  privileged: boolean;
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

export function rewriteUrlHost(url: string, host: string): string {
  if (!url || url.startsWith("file://") || url.startsWith("/") || url.startsWith(".")) {
    return url;
  }
  try {
    const parsed = new URL(url);
    parsed.hostname = host;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

export function withTapReachableUrls(spec: RuntimeSpec, hostIp: string): RuntimeSpec {
  const controlPlaneUrl = rewriteUrlHost(spec.controlPlaneUrl, hostIp);
  const llmGatewayUrl = rewriteUrlHost(spec.llmGatewayUrl, hostIp);
  const domains = [...new Set([...(spec.egress.domains ?? []), hostIp])];
  return {
    ...spec,
    controlPlaneUrl,
    llmGatewayUrl,
    egress: { ...spec.egress, domains },
  };
}

export function guestFacingBootstrap<T extends { llmGatewayUrl?: string; workspaceDir?: string }>(
  runId: string,
  bootstrap: T,
  controlPlaneUrl?: string,
): T & { llmGatewayUrl: string; workspaceDir: string; controlPlaneUrl?: string } {
  const tap = tapPlan(runId);
  return {
    ...bootstrap,
    workspaceDir: "/workspace",
    llmGatewayUrl: rewriteUrlHost(bootstrap.llmGatewayUrl ?? "", tap.hostIp),
    ...(controlPlaneUrl ? { controlPlaneUrl: rewriteUrlHost(controlPlaneUrl, tap.hostIp) } : {}),
  };
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
    "nomodules",
    "root=/dev/vda",
    "ro",
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

async function waitForPath(file: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`firecracker api socket not ready: ${file}`);
}

function canOpenKvm(): boolean {
  try {
    const fd = openSync("/dev/kvm", "r+");
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function spawnFirecracker(
  bin: string,
  args: string[],
  logFile: string,
): Promise<{ pid: number | null; stop: () => void; privileged: boolean; child: ChildProcess }> {
  mkdirSync(path.dirname(logFile), { recursive: true });
  const privileged = !canOpenKvm();
  const command = privileged ? "sudo" : bin;
  const commandArgs = privileged ? ["-n", bin, ...args] : args;
  const logFd = openSync(logFile, "a");
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["ignore", logFd, logFd] });
    child.once("error", (error) => {
      try {
        closeSync(logFd);
      } catch {
        // already closed
      }
      reject(error);
    });
    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      if (privileged && child.pid) {
        spawn("sudo", ["-n", "kill", "-TERM", String(child.pid)], { stdio: "ignore" });
        return;
      }
      child.kill("SIGTERM");
    };
    if (child.spawnfile) {
      resolve({ pid: child.pid ?? null, stop, privileged, child });
      return;
    }
    child.once("spawn", () => resolve({ pid: child.pid ?? null, stop, privileged, child }));
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
  const staging = path.join(tmpdir(), `neo-fc-ws-${createHash("sha256").update(destImg).digest("hex").slice(0, 16)}`);
  rmSync(staging, { recursive: true, force: true });
  try {
    await copyWorkspaceTree(srcDir, staging);
    await ensureSparseFile(destImg, sizeGiB);
    const mkfs = await run("mkfs.ext4", ["-F", "-d", staging, destImg]).catch(() => ({
      code: 1,
      stdout: "",
      stderr: "mkfs.ext4 missing",
    }));
    if (mkfs.code !== 0) {
      console.warn(`firecracker workspace image is sparse-only (${mkfs.stderr.trim() || "mkfs.ext4 failed"}); guest needs a rootfs that can mount it`);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
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

export function resolveFirecrackerBin(explicit?: string): string {
  if (explicit?.trim()) {
    return explicit.trim();
  }
  const env = (process.env.FIRECRACKER_BIN ?? "").trim();
  if (env) {
    return env;
  }
  const asset = path.join(firecrackerAssetsDir(), "firecracker");
  if (existsSync(asset)) {
    return asset;
  }
  return "firecracker";
}

export class FirecrackerRuntime implements ExecutionRuntime {
  private readonly children = new Map<string, ChildState>();
  private readonly options: FirecrackerOptions;

  constructor(options: FirecrackerOptions = {}) {
    this.options = options;
  }

  async provision(spec: RuntimeSpec, hooks?: RuntimeHooks): Promise<RuntimeHandle> {
    const assets = productionFirecrackerPaths();
    const kernel = this.options.kernel || assets.kernel;
    let rootfs = this.options.rootfs || assets.rootfs;
    if (!rootfs || !existsSync(rootfs)) {
      const packed = await ensureFirecrackerRootfs();
      if (packed && existsSync(packed) && statSync(packed).isFile()) {
        rootfs = packed;
      }
    }
    const bin = resolveFirecrackerBin(this.options.bin);
    if (!kernel || !rootfs || !existsSync(kernel) || !existsSync(rootfs)) {
      throw new Error("FIRECRACKER_KERNEL and FIRECRACKER_ROOTFS are required for WORKER_RUNTIME=firecracker");
    }
    await access(kernel);
    await access(rootfs);

    const net = this.options.net ?? (process.env.FIRECRACKER_NET === "none" ? "none" : "tap");
    const tap = net === "tap" ? tapPlan(spec.runId) : null;
    const guestSpec = tap ? withTapReachableUrls(spec, tap.hostIp) : spec;
    mkdirSync(guestSpec.hostWorkspaceDir, { recursive: true });
    writeRunBootstrap(guestSpec);

    const paths = firecrackerPaths(guestSpec);
    mkdirSync(paths.runDir, { recursive: true });
    if (existsSync(paths.sock)) {
      await unlink(paths.sock).catch(() => undefined);
    }
    const run = this.options.runCommand ?? runCommand;
    await packWorkspaceImage(guestSpec.hostWorkspaceDir, paths.workspaceImg, guestSpec.diskGiB || 8, run);

    if (tap) {
      await this.setupTap(tap, run);
    }

    const spawned =
      (await this.options.spawnProcess?.(bin, ["--api-sock", paths.sock, "--id", guestSpec.runId.slice(0, 8)], paths.sock)) ??
      (await spawnFirecracker(bin, ["--api-sock", paths.sock, "--id", guestSpec.runId.slice(0, 8)], paths.log));
    await (this.options.waitForSocket ?? waitForPath)(paths.sock);
    await this.ensureSocketWritable(paths.sock, run);
    const request = this.options.request ?? requestUnix;
    const calls = buildFirecrackerCalls(
      guestSpec,
      { kernel, rootfs, workspaceImg: paths.workspaceImg, vsock: paths.vsock },
      tap,
    );
    for (const call of calls) {
      const result = await request(paths.sock, call.method, call.path, call.body);
      if (result.status >= 300) {
        spawned.stop();
        throw new Error(`firecracker ${call.method} ${call.path} failed: ${result.status} ${result.text}`.trim());
      }
    }
    this.children.set(guestSpec.runId, {
      stop: spawned.stop,
      tap: tap ?? undefined,
      privileged: !canOpenKvm(),
    });
    hooks?.onLog?.(
      `firecracker ${guestSpec.runId} cid=${guestCid(guestSpec.runId)} ip=${tap?.guestIp ?? "none"} rootfs=${isProductionRootfs(rootfs) ? "production" : "overlay"}\n`,
    );
    return {
      id: `fc-${guestSpec.runId}`,
      runtime: "firecracker",
      ip: tap?.guestIp ?? null,
      pid: spawned.pid,
      socket: paths.sock,
      cid: guestCid(guestSpec.runId),
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
        spawn("sudo", ["-n", "kill", "-TERM", String(handle.pid)], { stdio: "ignore" });
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
      privileged: false,
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

  private async runNet(
    run: FirecrackerProcessRunner,
    command: string,
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const direct = await run(command, args).catch((error) => ({
      code: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    }));
    if (direct.code === 0 || /exists|file exists/i.test(direct.stderr + direct.stdout)) {
      return direct;
    }
    return run("sudo", ["-n", command, ...args]).catch((error) => ({
      code: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    }));
  }

  private async setupTap(tap: TapPlan, run: FirecrackerProcessRunner): Promise<void> {
    const user = process.env.SUDO_USER || process.env.USER || userInfo().username;
    const addTap = await this.runNet(run, "ip", ["tuntap", "add", "dev", tap.name, "mode", "tap", "user", user]);
    if (addTap.code !== 0 && !/exists|file exists/i.test(addTap.stderr + addTap.stdout)) {
      const retry = await this.runNet(run, "ip", ["tuntap", "add", "dev", tap.name, "mode", "tap"]);
      if (retry.code !== 0 && !/exists|file exists/i.test(retry.stderr + retry.stdout)) {
        throw new Error(`failed to configure tap ${tap.name}: ${retry.stderr || retry.stdout || `exit ${retry.code}`}`);
      }
    }
    const commands: string[][] = [
      ["addr", "add", `${tap.hostIp}/${tap.prefix}`, "dev", tap.name],
      ["link", "set", tap.name, "up"],
    ];
    for (const args of commands) {
      const result = await this.runNet(run, "ip", args);
      if (result.code !== 0 && !/exists|file exists/i.test(result.stderr + result.stdout)) {
        throw new Error(`failed to configure tap ${tap.name}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
      }
    }
    await this.runNet(run, "iptables", ["-I", "INPUT", "1", "-i", tap.name, "-j", "ACCEPT"]).catch(() => undefined);
  }

  private async teardownTap(tap: TapPlan): Promise<void> {
    const run = this.options.runCommand ?? runCommand;
    await this.runNet(run, "ip", ["link", "delete", tap.name]);
  }

  private async ensureSocketWritable(sock: string, run: FirecrackerProcessRunner): Promise<void> {
    try {
      await access(sock, constants.R_OK | constants.W_OK);
    } catch {
      const result = await run("sudo", ["-n", "chmod", "666", sock]).catch(() => ({
        code: 1,
        stdout: "",
        stderr: "chmod failed",
      }));
      if (result.code !== 0) {
        try {
          await access(sock, constants.R_OK);
        } catch {
          throw new Error(`firecracker api socket not writable: ${sock}`);
        }
      }
    }
  }
}

export function firecrackerAvailable(bin = resolveFirecrackerBin()): boolean {
  const resolved = bin.includes("/") ? existsSync(bin) : true;
  return existsSync("/dev/kvm") && resolved;
}

import { mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const workerDirs = new Map<number, string>();
let workersRoot: string | null | undefined;

/** Leave headroom under the cgroup/RSS cap for native buffers and tsx. */
export function heapMiBForWorker(memoryMiB: number): number {
  if (!Number.isFinite(memoryMiB) || memoryMiB <= 0) {
    return 0;
  }
  return Math.max(96, Math.floor(memoryMiB * 0.8));
}

export function nodeHeapArgs(memoryMiB: number): string[] {
  const heap = heapMiBForWorker(memoryMiB);
  return heap > 0 ? [`--max-old-space-size=${heap}`] : [];
}

export function resetProcessLimitsForTests(): void {
  workersRoot = undefined;
  workerDirs.clear();
}

function selfCgroupDir(): string | null {
  try {
    const text = readFileSync("/proc/self/cgroup", "utf8");
    const match = /^0::(.*)$/m.exec(text);
    if (!match) {
      return null;
    }
    const rel = match[1].trim().replace(/^\//, "");
    return path.join("/sys/fs/cgroup", rel);
  } catch {
    return null;
  }
}

function tryWrite(file: string, value: string): boolean {
  try {
    writeFileSync(file, value);
    return true;
  } catch {
    return false;
  }
}

function enableMemory(dir: string): void {
  const control = path.join(dir, "cgroup.subtree_control");
  try {
    const current = readFileSync(control, "utf8");
    if (!current.includes("memory")) {
      writeFileSync(control, "+memory");
    }
  } catch {
    // parent may already have memory, or we lack Delegate=
  }
}

function ensureWorkersRoot(): string | null {
  if (workersRoot !== undefined) {
    return workersRoot;
  }
  const self = selfCgroupDir();
  if (!self) {
    workersRoot = null;
    return null;
  }
  const parent = path.basename(self) === "main" ? path.dirname(self) : self;
  const main = path.join(parent, "main");
  const workers = path.join(parent, "workers");
  try {
    mkdirSync(main, { recursive: true });
    mkdirSync(workers, { recursive: true });
    if (self === parent) {
      if (!tryWrite(path.join(main, "cgroup.procs"), String(process.pid))) {
        workersRoot = null;
        return null;
      }
    }
    enableMemory(parent);
    enableMemory(workers);
    workersRoot = workers;
    return workers;
  } catch {
    workersRoot = null;
    return null;
  }
}

export function applyWorkerMemoryLimit(
  pid: number,
  memoryMiB: number,
): { ok: boolean; method: "cgroup" | "none" } {
  if (!pid || !Number.isFinite(memoryMiB) || memoryMiB <= 0) {
    return { ok: false, method: "none" };
  }
  const root = ensureWorkersRoot();
  if (!root) {
    return { ok: false, method: "none" };
  }
  const dir = path.join(root, `pid-${pid}`);
  try {
    mkdirSync(dir, { recursive: true });
    const bytes = String(Math.floor(memoryMiB * 1024 * 1024));
    if (!tryWrite(path.join(dir, "memory.max"), bytes)) {
      try {
        rmdirSync(dir);
      } catch {
        // ignore
      }
      return { ok: false, method: "none" };
    }
    tryWrite(path.join(dir, "memory.swap.max"), "0");
    if (!tryWrite(path.join(dir, "cgroup.procs"), String(pid))) {
      try {
        rmdirSync(dir);
      } catch {
        // ignore
      }
      return { ok: false, method: "none" };
    }
    workerDirs.set(pid, dir);
    return { ok: true, method: "cgroup" };
  } catch {
    return { ok: false, method: "none" };
  }
}

export function releaseWorkerMemoryLimit(pid: number | null | undefined): void {
  if (!pid) {
    return;
  }
  const dir = workerDirs.get(pid);
  workerDirs.delete(pid);
  if (!dir) {
    return;
  }
  try {
    rmdirSync(dir);
  } catch {
    // process may still be leaving the cgroup
  }
}

import { spawn, spawnSync } from "node:child_process";
import type { ExecutionRuntime, RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";
import { assertNoProviderSecrets, buildWorkerEnv, containerName } from "./worker-env.js";

export interface DockerInvocation {
  command: string;
  prefix: string[];
}

let cachedInvocation: DockerInvocation | undefined;

/** Prefer an unprivileged `docker` CLI; fall back to passwordless sudo in Cloud Agent shells. */
export function resolveDockerInvocation(): DockerInvocation {
  if (cachedInvocation) {
    return cachedInvocation;
  }
  const direct = spawnSync("docker", ["info"], { encoding: "utf8", timeout: 5000 });
  if (direct.status === 0) {
    cachedInvocation = { command: "docker", prefix: [] };
    return cachedInvocation;
  }
  const elevated = spawnSync("sudo", ["-n", "docker", "info"], { encoding: "utf8", timeout: 5000 });
  if (elevated.status === 0) {
    cachedInvocation = { command: "sudo", prefix: ["-n", "docker"] };
    return cachedInvocation;
  }
  cachedInvocation = { command: "docker", prefix: [] };
  return cachedInvocation;
}

export function resetDockerInvocationForTests(): void {
  cachedInvocation = undefined;
}

export interface RuntimeHooks {
  onExit?: (code: number | null) => void;
  onLog?: (chunk: string) => void;
}

export interface DockerCli {
  run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }>;
}

export function buildDockerRunArgs(spec: RuntimeSpec, extraHosts: string[] = ["host.docker.internal:host-gateway"]): string[] {
  const name = containerName(spec.runId);
  const workspaceBind = spec.hostWorkspaceBind ?? spec.hostWorkspaceDir;
  const sessionDir = "/var/neo/sessions";
  const env = buildWorkerEnv({
    runId: spec.runId,
    jwt: spec.jwt,
    controlPlaneUrl: spec.controlPlaneUrl,
    llmGatewayUrl: spec.llmGatewayUrl,
    workspaceDir: spec.workspaceMount,
    sessionDir,
    model: spec.model,
  });
  assertNoProviderSecrets(env);

  const args = ["run", "-d", "--name", name, "--label", `neo.run_id=${spec.runId}`];
  if (spec.memoryMiB > 0) {
    args.push("--memory", `${spec.memoryMiB}m`);
  }
  if (spec.cpu > 0) {
    args.push("--cpus", String(spec.cpu));
  }
  for (const [key, value] of Object.entries(env)) {
    args.push("-e", `${key}=${value}`);
  }
  args.push("-v", `${workspaceBind}:${spec.workspaceMount}`);
  for (const host of extraHosts) {
    args.push("--add-host", host);
  }
  if (spec.dockerNetwork) {
    args.push("--network", spec.dockerNetwork);
  }
  args.push(spec.image);
  if (spec.command && spec.command.length > 0) {
    args.push(...spec.command);
  }
  return args;
}

export function spawnDocker(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const invocation = resolveDockerInvocation();
    const child = spawn(invocation.command, [...invocation.prefix, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("docker CLI not found; install Docker or set WORKER_RUNTIME=local"));
        return;
      }
      reject(error);
    });
    child.on("exit", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export class DockerRuntime implements ExecutionRuntime {
  private readonly cli: DockerCli;
  private readonly extraHosts: string[];
  private readonly waiters = new Map<string, ReturnType<typeof spawn>>();

  constructor(cli: DockerCli = { run: spawnDocker }, extraHosts?: string[]) {
    this.cli = cli;
    this.extraHosts = extraHosts ?? ["host.docker.internal:host-gateway"];
  }

  async provision(spec: RuntimeSpec, hooks?: RuntimeHooks): Promise<RuntimeHandle> {
    const args = buildDockerRunArgs(spec, this.extraHosts);
    const result = await this.cli.run(args);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `docker run exited ${result.code}`);
    }
    const name = containerName(spec.runId);
    this.watchExit(name, hooks);
    return { id: name, runtime: "docker", ip: null };
  }

  async snapshot(handle: RuntimeHandle): Promise<string> {
    return `snap-${handle.id}`;
  }

  async restore(snapshotId: string, spec: RuntimeSpec): Promise<RuntimeHandle> {
    return { id: `docker-${spec.runId}-from-${snapshotId}`, runtime: "docker", ip: null };
  }

  async destroy(handle: RuntimeHandle): Promise<void> {
    const waiter = this.waiters.get(handle.id);
    waiter?.kill("SIGTERM");
    this.waiters.delete(handle.id);
    await this.cli.run(["rm", "-f", handle.id]);
  }

  private watchExit(name: string, hooks?: RuntimeHooks): void {
    if (!hooks?.onExit) {
      return;
    }
    const invocation = resolveDockerInvocation();
    const waiter = spawn(invocation.command, [...invocation.prefix, "wait", name], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.waiters.set(name, waiter);
    waiter.stdout?.on("data", (chunk) => {
      const code = Number(String(chunk).trim());
      hooks.onExit?.(Number.isFinite(code) ? code : null);
    });
    waiter.on("error", () => {
      hooks.onExit?.(null);
    });
  }
}

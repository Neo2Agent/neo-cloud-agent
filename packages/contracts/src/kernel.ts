/** Which process owns the agent ReAct loop. */
export type AgentKernel = "pi" | "agentscope";

export const AGENT_KERNELS: readonly AgentKernel[] = ["pi", "agentscope"];

/** Env bag used by kernel helpers. Avoid NodeJS types so browser packages can typecheck. */
export type KernelEnv = {
  AGENT_KERNEL?: string;
  WORKER_ROLE?: string;
};

export function parseAgentKernel(value: unknown): AgentKernel | undefined {
  return value === "pi" || value === "agentscope" ? value : undefined;
}

/** Default stays pi so existing tests and production keep the colocated worker. */
export function defaultAgentKernel(env: KernelEnv = {}): AgentKernel {
  return parseAgentKernel(env.AGENT_KERNEL) ?? "pi";
}

export function resolveAgentKernel(value?: unknown, env: KernelEnv = {}): AgentKernel {
  return parseAgentKernel(value) ?? defaultAgentKernel(env);
}

export type WorkerRole = "all" | "tools";

export function parseWorkerRole(value: unknown): WorkerRole | undefined {
  return value === "all" || value === "tools" ? value : undefined;
}

export function resolveWorkerRole(env: KernelEnv = {}): WorkerRole {
  return parseWorkerRole(env.WORKER_ROLE) ?? "all";
}

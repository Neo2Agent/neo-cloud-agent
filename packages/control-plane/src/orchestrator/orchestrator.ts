import type {
  CreateFollowUpRequest,
  CreateRunRequest,
  FollowUp,
  FollowUpDelivery,
  Run,
  RunEvent,
  RuntimeHandle,
  RuntimeSpec,
  WorkerInbound,
} from "@neo-cloud-agent/contracts";
import { mintRunToken } from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";
import { publish } from "../events/bus.js";
import { getRuntime } from "../runtime/factory.js";
import { materializeRepos } from "../scm/workspace.js";
import { hostWorkspaceFor, repoRoot, workspaceFor } from "../worker-spawn.js";

const runs = new Map<string, Run>();
const followUps = new Map<string, FollowUp[]>();
const inbound = new Map<string, WorkerInbound[]>();
const runJwts = new Map<string, string>();
const handles = new Map<string, RuntimeHandle>();

function now(): string {
  return new Date().toISOString();
}

export function event(runId: string, kind: RunEvent["kind"], title: string, extra?: Partial<RunEvent>): RunEvent {
  return {
    id: extra?.id ?? crypto.randomUUID(),
    runId,
    createdAt: extra?.createdAt ?? now(),
    category:
      extra?.category ??
      (kind.startsWith("run.install") || kind.startsWith("run.") || kind.startsWith("scm.")
        ? "agent_setup"
        : "agent_run"),
    level: extra?.level ?? (kind === "run.error" ? "error" : "info"),
    kind,
    title,
    detail: extra?.detail,
    data: extra?.data,
  };
}

export function mintJwtForRun(run: Run): string {
  const config = getConfig();
  const token = mintRunToken(config.jwtSecret, {
    sub: run.userId,
    runId: run.id,
    orgId: run.orgId,
    model: run.model,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    jti: crypto.randomUUID(),
  });
  runJwts.set(run.id, token);
  return token;
}

function workerCommand(): string[] | undefined {
  const raw = process.env.WORKER_COMMAND;
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // fall through to whitespace split
  }
  return raw.split(/\s+/).filter(Boolean);
}

function launchSpec(run: Run, jwt: string): RuntimeSpec {
  const config = getConfig();
  return {
    runId: run.id,
    image: config.workerImage,
    snapshotId: null,
    cpu: Number(process.env.WORKER_CPUS ?? 2),
    memoryMiB: Number(process.env.WORKER_MEMORY_MIB ?? 2048),
    diskGiB: 40,
    egress: { mode: "allow_all", domains: [] },
    jwt,
    model: run.model,
    hostWorkspaceDir: workspaceFor(run.id),
    hostWorkspaceBind: hostWorkspaceFor(run.id),
    workspaceMount: config.workerWorkspaceMount,
    controlPlaneUrl: config.workerControlPlaneUrl,
    llmGatewayUrl: config.workerLlmGatewayUrl,
    dockerNetwork: config.dockerNetwork,
    command: workerCommand(),
  };
}

function runningTitle(): string {
  const kind = getConfig().workerRuntime;
  if (kind === "local") return "Spawning local worker";
  if (kind === "docker") return "Starting Docker worker";
  return "Worker handle reserved";
}

export async function createRun(input: CreateRunRequest): Promise<Run> {
  const config = getConfig();
  const createdAt = now();
  const run: Run = {
    id: crypto.randomUUID(),
    orgId: config.orgId,
    userId: config.userId,
    envId: input.envId ?? null,
    envVersionId: null,
    buildId: null,
    status: "PROVISIONING",
    setupStatus: null,
    source: input.source ?? "api",
    model: input.model ?? config.defaultModel,
    prompt: input.prompt,
    branchName: null,
    repoUrls: input.repoUrls,
    workerHandle: null,
    createdAt,
    updatedAt: createdAt,
    idleAt: null,
    expiresAt: null,
    errorMessage: null,
  };
  runs.set(run.id, run);
  followUps.set(run.id, []);
  inbound.set(run.id, [{ type: "prompt", text: input.prompt, images: input.images }]);
  publish(event(run.id, "run.provisioning", "Provisioning worker"));
  publish(
    event(run.id, "user.message", "User message", {
      category: "agent_run",
      data: { text: input.prompt, source: run.source },
    }),
  );
  mintJwtForRun(run);

  try {
    if (run.repoUrls.length > 0) {
      publish(
        event(run.id, "scm.clone_started", "Preparing workspace", {
          data: { repoUrls: run.repoUrls },
        }),
      );
      const placed = await materializeRepos(run.repoUrls, workspaceFor(run.id), repoRoot());
      publish(
        event(run.id, "scm.clone_succeeded", "Workspace ready", {
          data: {
            dests: placed.map((item) => ({ name: item.ref.name, kind: item.ref.kind, source: item.ref.raw })),
          },
        }),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "workspace prepare failed";
    run.status = "ERROR";
    run.errorMessage = message;
    run.updatedAt = now();
    publish(event(run.id, "scm.clone_failed", "Workspace prepare failed", { level: "error", detail: message }));
    publish(event(run.id, "run.error", message));
    return run;
  }

  try {
    const handle = await getRuntime().provision(launchSpec(run, runJwts.get(run.id) ?? mintJwtForRun(run)), {
      onExit: (code) => {
        const current = runs.get(run.id);
        if (!current || current.status === "ARCHIVED" || current.status === "EXPIRED") {
          return;
        }
        if (code !== 0 && current.status === "RUNNING") {
          current.status = "ERROR";
          current.errorMessage = `worker exited with code ${code}`;
          current.updatedAt = now();
          publish(event(run.id, "run.error", current.errorMessage));
        }
      },
    });
    handles.set(run.id, handle);
    run.workerHandle = handle.id;
    run.status = "RUNNING";
    run.updatedAt = now();
    publish(event(run.id, "run.running", runningTitle()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "worker provision failed";
    run.status = "ERROR";
    run.errorMessage = message;
    run.updatedAt = now();
    publish(event(run.id, "run.error", message));
    return run;
  }
  return run;
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

export function listRuns(): Run[] {
  return [...runs.values()];
}

export function getBootstrap(runId: string) {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  const config = getConfig();
  return {
    run,
    jwt: runJwts.get(runId) ?? mintJwtForRun(run),
    llmGatewayUrl: config.workerLlmGatewayUrl,
    workspaceDir: config.workerRuntime === "docker" ? config.workerWorkspaceMount : workspaceFor(runId),
  };
}

export function ingestEvents(runId: string, events: RunEvent[]): void {
  if (!runs.has(runId)) {
    throw new Error(`run not found: ${runId}`);
  }
  for (const item of events) {
    publish(event(runId, item.kind, item.title, item));
    if (item.kind === "agent.end") {
      const run = runs.get(runId);
      if (run && run.status === "RUNNING") {
        run.status = "IDLE";
        run.idleAt = now();
        run.updatedAt = now();
        publish(event(runId, "run.idle", "Agent turn finished"));
      }
    }
    if (item.kind === "agent.start") {
      const run = runs.get(runId);
      if (run) {
        run.status = "RUNNING";
        run.idleAt = null;
        run.updatedAt = now();
      }
    }
  }
}

export function enqueueFollowUp(runId: string, input: CreateFollowUpRequest): FollowUp {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  const delivery: FollowUpDelivery =
    input.delivery ?? (run.status === "RUNNING" ? "follow_up" : "prompt");
  const item: FollowUp = {
    id: crypto.randomUUID(),
    runId,
    text: input.text,
    images: input.images,
    delivery,
    status: "queued",
    createdAt: now(),
    deliveredAt: null,
  };
  followUps.get(runId)?.push(item);
  inbound.get(runId)?.push({
    type: delivery,
    text: input.text,
    images: input.images,
  });
  publish(
    event(runId, "followup.queued", "Follow-up queued", {
      data: { followUpId: item.id, delivery },
    }),
  );
  publish(
    event(runId, "user.message", "User message", {
      category: "agent_run",
      data: { text: input.text, followUpId: item.id, delivery },
    }),
  );
  return item;
}

export function listFollowUps(runId: string): FollowUp[] {
  return followUps.get(runId) ?? [];
}

export function takeInbound(runId: string): WorkerInbound[] {
  const queued = inbound.get(runId) ?? [];
  inbound.set(runId, []);
  const deliveredAt = now();
  for (const item of followUps.get(runId) ?? []) {
    if (item.status === "queued") {
      item.status = "delivered";
      item.deliveredAt = deliveredAt;
    }
  }
  return queued;
}

export async function archiveRun(runId: string): Promise<Run> {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  run.status = "ARCHIVED";
  run.updatedAt = now();
  inbound.get(runId)?.push({ type: "shutdown", reason: "archived" });
  const handle = handles.get(runId);
  if (handle) {
    await getRuntime().destroy(handle);
    handles.delete(runId);
  }
  publish(event(runId, "run.archived", "Run archived"));
  return run;
}

export function abortRun(runId: string): Run {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  inbound.get(runId)?.push({ type: "abort" });
  run.updatedAt = now();
  return run;
}

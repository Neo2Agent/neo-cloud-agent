import type { EgressPolicy, RunEvent } from "@neo-cloud-agent/contracts";
import { getWorkerConfig } from "./config.js";
import { runWorkspaceBoot, stopTerminals } from "./boot.js";
import { downloadSession, enqueueEvents, fetchBootstrap, pullInbox, pushEvents, uploadSession } from "./channel.js";
import { installEgressGuard, policyFromEnv } from "./egress.js";
import { inspectSessionContext } from "./context-usage.js";
import { contextUsageEvent, stampWorkerSeq, toRunEvents } from "./events.js";
import { collectSessionFiles, restoreSessionFiles } from "./session-backup.js";
import { describeDispatch, dispatchInbound, openPiSession } from "./session.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backupSession(runId: string, sessionDir: string): Promise<void> {
  try {
    await uploadSession(runId, collectSessionFiles(sessionDir));
  } catch (error: unknown) {
    console.error("failed to backup session", error);
  }
}

async function main(): Promise<void> {
  const config = getWorkerConfig();
  const workerSeq = { value: 0 };
  if (!config.runId) {
    console.log("worker image entrypoint. Set RUN_ID to attach to a control-plane run.");
    return;
  }

  const bootstrap = config.llmGatewayJwt
    ? {
        jwt: config.llmGatewayJwt,
        llmGatewayUrl: config.llmGatewayUrl,
        workspaceDir: config.workspaceDir,
        model: config.model,
        egress: config.egress,
      }
    : await fetchBootstrap(config.runId);

  const workspaceDir = bootstrap.workspaceDir || config.workspaceDir;
  const egress: EgressPolicy = policyFromEnv(process.env, bootstrap.egress);
  installEgressGuard(egress, (decision) => {
    const event: RunEvent = {
      id: crypto.randomUUID(),
      runId: config.runId,
      createdAt: new Date().toISOString(),
      category: "agent_setup",
      level: "error",
      kind: "egress.denied",
      title: `Blocked outbound host ${decision.host}`,
      detail: decision.reason,
      data: { host: decision.host, mode: decision.mode },
    };
    enqueueEvents(config.runId, stampWorkerSeq([event], workerSeq)).catch((error: unknown) => {
      console.error("failed to report egress denial", error);
    });
  });
  console.log(
    `worker ${config.runId} version=${config.workerVersion} model=${bootstrap.model} gateway=${bootstrap.llmGatewayUrl}`,
  );

  const boot = await runWorkspaceBoot({ runId: config.runId, workspaceDir });
  if (boot.events.length > 0) {
    await pushEvents(config.runId, stampWorkerSeq(boot.events, workerSeq));
  }
  if (boot.fatal) {
    stopTerminals(boot.terminals);
    process.exitCode = 2;
    return;
  }

  try {
    restoreSessionFiles(config.sessionDir, await downloadSession(config.runId));
  } catch (error: unknown) {
    console.error("failed to restore session", error);
  }

  const session = await openPiSession({
    cwd: workspaceDir,
    sessionDir: config.sessionDir,
    runId: config.runId,
    jwt: bootstrap.jwt,
    gatewayUrl: bootstrap.llmGatewayUrl,
    modelId: bootstrap.model,
    onSubagentEvent: (event, nest) => {
      enqueueEvents(config.runId, stampWorkerSeq(toRunEvents(config.runId, event, { nest }), workerSeq)).catch(
        (error: unknown) => {
          console.error("failed to push subagent events", error);
        },
      );
    },
  });

  const pushContext = (reportedTokens?: number) => {
    try {
      const snapshot = inspectSessionContext(session, {
        modelId: bootstrap.model,
        reportedTokens,
      });
      enqueueEvents(config.runId, stampWorkerSeq([contextUsageEvent(config.runId, snapshot)], workerSeq)).catch(
        (error: unknown) => {
          console.error("failed to push context usage", error);
        },
      );
    } catch (error: unknown) {
      console.error("failed to inspect context usage", error);
    }
  };

  const unsubscribe = session.subscribe((event) => {
    const mapped = stampWorkerSeq(toRunEvents(config.runId, event), workerSeq);
    enqueueEvents(config.runId, mapped).catch((error: unknown) => {
      console.error("failed to push events", error);
    });
    if (event.type === "agent_start" || event.type === "agent_end" || event.type === "compaction_end") {
      const usage = mapped.find((item) => item.kind === "llm.usage")?.data;
      const promptTokens = Number(usage?.promptTokens ?? 0);
      pushContext(promptTokens > 0 ? promptTokens : undefined);
    }
    if (mapped.some((item) => item.kind === "agent.end")) {
      void backupSession(config.runId, config.sessionDir);
    }
  });
  pushContext();

  let running = true;
  const stop = async () => {
    running = false;
    await session.abort();
  };
  process.on("SIGINT", () => {
    void stop();
  });
  process.on("SIGTERM", () => {
    void stop();
  });

  let consecutiveFailures = 0;
  const maxFailures = Number(process.env.WORKER_INBOX_MAX_FAILURES ?? 75);

  try {
    while (running) {
      let messages;
      try {
        messages = await pullInbox(config.runId);
        consecutiveFailures = 0;
      } catch (error: unknown) {
        consecutiveFailures += 1;
        console.error(`inbox unavailable (${consecutiveFailures}/${maxFailures}), retrying`, error);
        if (consecutiveFailures >= maxFailures) {
          throw new Error(`control plane unreachable after ${maxFailures} inbox attempts`);
        }
        await sleep(config.pollMs);
        continue;
      }
      for (const message of messages) {
        console.log(`[worker ${config.runId}] ${describeDispatch(message)}`);
        const next = await dispatchInbound(session, message);
        if (next === "stop") {
          running = false;
          break;
        }
      }
      if (running) {
        await sleep(config.pollMs);
      }
    }
  } finally {
    unsubscribe();
    await backupSession(config.runId, config.sessionDir);
    stopTerminals(boot.terminals);
    session.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

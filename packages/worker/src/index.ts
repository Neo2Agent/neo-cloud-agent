import type { EgressPolicy, RunEvent } from "@neo-cloud-agent/contracts";
import { getWorkerConfig } from "./config.js";
import { runWorkspaceBoot, stopTerminals } from "./boot.js";
import { downloadSession, enqueueEvents, fetchBootstrap, pullInbox, pushEvents, uploadSession } from "./channel.js";
import { installEgressGuard, policyFromEnv } from "./egress.js";
import { inspectSessionContext } from "./context-usage.js";
import { contextUsageEvent, emptyAgentTurnEvent, stampWorkerSeq, toRunEvents, turnFinishedEvent, type LooseAgentEvent } from "./events.js";
import { collectSessionFiles, restoreSessionFiles } from "./session-backup.js";
import { readSessionBackupPolicy, shouldBackupSession } from "./session-backup-schedule.js";
import { runInboxLoop } from "./inbox-loop.js";
import { describeDispatch, dispatchInbound, openPiSession } from "./session.js";
import { abortNestedSubagents } from "./subagent.js";

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

  const workspaceDir = process.env.WORKSPACE_DIR || bootstrap.workspaceDir || config.workspaceDir;
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

  const boot = await runWorkspaceBoot({
    runId: config.runId,
    workspaceDir,
    scratchDir: config.scratchDir,
  });
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

  const backupPolicy = readSessionBackupPolicy();
  let agentRunning = false;
  let turnHadVisibleWork = false;
  let toolsSinceBackup = 0;
  let lastBackupAt = 0;
  let backupInFlight = false;

  const requestBackup = (force = false) => {
    if (backupInFlight) {
      return;
    }
    if (
      !force &&
      !shouldBackupSession({
        now: Date.now(),
        lastBackupAt,
        toolsSinceBackup,
        agentRunning,
        policy: backupPolicy,
      })
    ) {
      return;
    }
    backupInFlight = true;
    toolsSinceBackup = 0;
    lastBackupAt = Date.now();
    void backupSession(config.runId, config.sessionDir).finally(() => {
      backupInFlight = false;
    });
  };

  const unsubscribe = session.subscribe((event) => {
    const loose = event as LooseAgentEvent;
    if (loose.type === "agent_start") {
      turnHadVisibleWork = false;
    }
    if (loose.type === "tool_execution_start") {
      turnHadVisibleWork = true;
    }
    if (
      loose.type === "message_update" &&
      loose.assistantMessageEvent?.type === "text_delta" &&
      loose.assistantMessageEvent.delta
    ) {
      turnHadVisibleWork = true;
    }
    const mapped = stampWorkerSeq(toRunEvents(config.runId, loose), workerSeq);
    if (
      event.type === "agent_end" &&
      !turnHadVisibleWork &&
      !mapped.some((item) => item.kind === "llm.error")
    ) {
      mapped.push(...stampWorkerSeq([emptyAgentTurnEvent(config.runId)], workerSeq));
    }
    enqueueEvents(config.runId, mapped).catch((error: unknown) => {
      console.error("failed to push events", error);
    });
    if (event.type === "agent_start") {
      agentRunning = true;
    }
    if (mapped.some((item) => item.kind === "tool.end")) {
      toolsSinceBackup += mapped.filter((item) => item.kind === "tool.end").length;
      requestBackup();
    }
    if (event.type === "agent_start" || event.type === "agent_end" || event.type === "compaction_end") {
      const usage = mapped.find((item) => item.kind === "llm.usage")?.data;
      const promptTokens = Number(usage?.promptTokens ?? 0);
      pushContext(promptTokens > 0 ? promptTokens : undefined);
    }
    if (mapped.some((item) => item.kind === "agent.end")) {
      agentRunning = false;
      requestBackup(true);
    }
  });
  const incrementalBackup = setInterval(() => {
    requestBackup();
  }, Math.max(5_000, Math.min(backupPolicy.intervalMs, 30_000)));
  incrementalBackup.unref();
  pushContext();

  let running = true;
  const stop = async () => {
    running = false;
    abortNestedSubagents();
    await session.abort();
  };
  process.on("SIGINT", () => {
    void stop();
  });
  process.on("SIGTERM", () => {
    void stop();
  });

  const maxFailures = Number(process.env.WORKER_INBOX_MAX_FAILURES ?? 75);

  try {
    await runInboxLoop({
      pull: () => pullInbox(config.runId),
      dispatch: async (message) => {
        console.log(`[worker ${config.runId}] ${describeDispatch(message)}`);
        return dispatchInbound(session, message);
      },
      afterUserTurn: async () => {
        try {
          await enqueueEvents(config.runId, stampWorkerSeq([turnFinishedEvent(config.runId)], workerSeq));
        } catch (error: unknown) {
          console.error("failed to push turn end", error);
        }
      },
      isStreaming: () => session.isStreaming,
      pollMs: config.pollMs,
      exitAfterTurn: config.exitAfterTurn,
      shouldStop: () => !running,
      onPullError: async (error, consecutiveFailures) => {
        console.error(`inbox unavailable (${consecutiveFailures}/${maxFailures}), retrying`, error);
        if (consecutiveFailures >= maxFailures) {
          throw new Error(`control plane unreachable after ${maxFailures} inbox attempts`);
        }
        return "retry";
      },
    });
    if (config.exitAfterTurn) {
      console.log(`[worker ${config.runId}] turn finished, exiting`);
    }
  } finally {
    clearInterval(incrementalBackup);
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

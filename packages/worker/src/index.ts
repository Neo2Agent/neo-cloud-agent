import { getWorkerConfig } from "./config.js";
import { runWorkspaceBoot, stopTerminals } from "./boot.js";
import { fetchBootstrap, pullInbox, pushEvents, uploadSession } from "./channel.js";
import { toRunEvents } from "./events.js";
import { collectSessionFiles } from "./session-backup.js";
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
      }
    : await fetchBootstrap(config.runId);

  const workspaceDir = bootstrap.workspaceDir || config.workspaceDir;
  console.log(
    `worker ${config.runId} version=${config.workerVersion} model=${bootstrap.model} gateway=${bootstrap.llmGatewayUrl}`,
  );

  const boot = await runWorkspaceBoot({ runId: config.runId, workspaceDir });
  if (boot.events.length > 0) {
    await pushEvents(config.runId, boot.events);
  }

  const session = await openPiSession({
    cwd: workspaceDir,
    sessionDir: config.sessionDir,
    runId: config.runId,
    jwt: bootstrap.jwt,
    gatewayUrl: bootstrap.llmGatewayUrl,
    modelId: bootstrap.model,
  });

  const unsubscribe = session.subscribe((event) => {
    const mapped = toRunEvents(config.runId, event);
    pushEvents(config.runId, mapped).catch((error: unknown) => {
      console.error("failed to push events", error);
    });
    if (mapped.some((item) => item.kind === "agent.end")) {
      void backupSession(config.runId, config.sessionDir);
    }
  });

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

  try {
    while (running) {
      const messages = await pullInbox(config.runId);
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

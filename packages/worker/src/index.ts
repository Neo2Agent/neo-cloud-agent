import { getWorkerConfig } from "./config.js";
import { fetchBootstrap, pullInbox, pushEvents } from "./channel.js";
import { toRunEvents } from "./events.js";
import { describeDispatch, dispatchInbound, openPiSession } from "./session.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  console.log(
    `worker ${config.runId} version=${config.workerVersion} model=${bootstrap.model} gateway=${bootstrap.llmGatewayUrl}`,
  );

  const session = await openPiSession({
    cwd: bootstrap.workspaceDir || config.workspaceDir,
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
    session.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

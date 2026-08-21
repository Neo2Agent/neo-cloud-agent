import { config } from "./config.js";
import { heartbeat, pullInbox } from "./channel.js";
import { handleInbound } from "./session.js";

async function main(): Promise<void> {
  if (!config.runId) {
    console.log("worker image entrypoint. Set RUN_ID to attach to a control-plane run.");
    console.log(JSON.stringify(heartbeat("unassigned", "booting")));
    return;
  }

  console.log(`worker ${config.runId} version=${config.workerVersion}`);
  const messages = await pullInbox(config.runId);
  for (const message of messages) {
    await handleInbound(message);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

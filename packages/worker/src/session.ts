import { deliveryForPi, type WorkerInbound } from "@neo-cloud-agent/contracts";
import { loadCloudExtensions } from "@neo-cloud-agent/extensions";
import { config } from "./config.js";

/**
 * P0 stub. P0 implementation should call:
 *   createAgentSession() from @earendil-works/pi-coding-agent
 * with ModelRuntime pointed at LLM_GATEWAY_URL and a run-scoped JWT.
 * Do not write provider keys to the VM disk.
 */
export async function handleInbound(message: WorkerInbound): Promise<void> {
  const extensions = loadCloudExtensions();
  if (message.type === "shutdown" || message.type === "abort" || message.type === "set_model") {
    console.log(`[worker ${config.runId}] ${message.type}`, message);
    return;
  }

  const piMethod = deliveryForPi(message.type);
  console.log(
    `[worker ${config.runId}] would session.${piMethod}(${JSON.stringify(message.text)})`,
    `cwd=${config.workspaceDir}`,
    `extensions=${extensions.map((item) => item.name).join(",")}`,
    `gateway=${config.llmGatewayUrl}`,
  );
}

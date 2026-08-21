import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { deliveryForPi, type WorkerInbound } from "@neo-cloud-agent/contracts";
import { CLOUD_SYSTEM_PROMPT, createPiCloudTools, sessionToolNames } from "./cloud-tools.js";
import { getWorkerConfig } from "./config.js";
import { materializeInboundImages } from "./images.js";

export interface OpenSessionInput {
  cwd: string;
  sessionDir: string;
  runId: string;
  jwt: string;
  gatewayUrl: string;
  modelId: string;
  controlPlaneUrl?: string;
}

function isolatedLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => CLOUD_SYSTEM_PROMPT,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

export async function openPiSession(input: OpenSessionInput): Promise<AgentSession> {
  mkdirSync(input.cwd, { recursive: true });
  mkdirSync(input.sessionDir, { recursive: true });
  const agentDir = path.join(input.sessionDir, "agent");
  mkdirSync(agentDir, { recursive: true });

  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });

  const publicId = input.modelId.includes("/") ? input.modelId.split("/")[1]! : input.modelId;
  modelRuntime.registerProvider("neo-gateway", {
    name: "Neo LLM Gateway",
    baseUrl: `${input.gatewayUrl.replace(/\/$/, "")}/v1`,
    api: "openai-completions",
    models: [
      {
        id: publicId,
        name: input.modelId,
        api: "openai-completions",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      },
    ],
  });
  await modelRuntime.setRuntimeApiKey("neo-gateway", input.jwt);

  const model = modelRuntime.getModel("neo-gateway", publicId);
  if (!model) {
    throw new Error(`failed to register gateway model ${input.modelId}`);
  }

  const config = getWorkerConfig();
  const customTools = createPiCloudTools({
    runId: input.runId,
    jwt: input.jwt,
    controlPlaneUrl: input.controlPlaneUrl ?? config.controlPlaneUrl,
    workspaceDir: input.cwd,
  });

  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir,
    model,
    thinkingLevel: "off",
    modelRuntime,
    resourceLoader: isolatedLoader(),
    tools: sessionToolNames(),
    customTools,
    sessionManager: SessionManager.create(input.cwd, input.sessionDir),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    }),
  });
  return session;
}

export async function dispatchInbound(session: AgentSession, message: WorkerInbound): Promise<"continue" | "stop"> {
  if (message.type === "shutdown") {
    await session.abort();
    return "stop";
  }
  if (message.type === "abort") {
    await session.abort();
    return "continue";
  }
  if (message.type === "set_model") {
    return "continue";
  }

  const method = deliveryForPi(message.type);
  const text = promptText(message);
  if (session.isStreaming) {
    if (method === "steer") {
      await session.steer(text);
    } else {
      await session.followUp(text);
    }
    return "continue";
  }
  await session.prompt(text);
  return "continue";
}

function promptText(message: Extract<WorkerInbound, { text: string }>): string {
  const attached = materializeInboundImages(getWorkerConfig().workspaceDir, message.images);
  return attached.note ? `${message.text}\n\n${attached.note}` : message.text;
}

export function describeDispatch(message: WorkerInbound): string {
  const config = getWorkerConfig();
  if (message.type === "shutdown" || message.type === "abort" || message.type === "set_model") {
    return message.type;
  }
  return `session.${deliveryForPi(message.type)} cwd=${config.workspaceDir}`;
}

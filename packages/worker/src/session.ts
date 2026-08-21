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
import { getWorkerConfig } from "./config.js";

export interface OpenSessionInput {
  cwd: string;
  sessionDir: string;
  runId: string;
  jwt: string;
  gatewayUrl: string;
  modelId: string;
}

function isolatedLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () =>
      `You are Neo Cloud Agent running in an isolated workspace.
Repositories the user attached are already in the current working directory (one repo at the root, or each repo in its own folder).
Use the local tools (read, write, edit, bash, grep, find, ls) to complete the user's task.
If you change the project, run its tests (for example \`sh test.sh\` or the documented test command).
Do not ask for API keys. LLM calls already go through the cloud gateway.
Be concise and verify your work.`,
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
        input: ["text"],
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

  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir,
    model,
    thinkingLevel: "off",
    modelRuntime,
    resourceLoader: isolatedLoader(),
    tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
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
  if (session.isStreaming) {
    if (method === "steer") {
      await session.steer(message.text);
    } else {
      await session.followUp(message.text);
    }
    return "continue";
  }
  await session.prompt(message.text);
  return "continue";
}

export function describeDispatch(message: WorkerInbound): string {
  const config = getWorkerConfig();
  if (message.type === "shutdown" || message.type === "abort" || message.type === "set_model") {
    return message.type;
  }
  return `session.${deliveryForPi(message.type)} cwd=${config.workspaceDir}`;
}

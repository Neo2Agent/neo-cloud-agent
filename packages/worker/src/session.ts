import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  appendExpertRole,
  appendProjectInstruction,
  deliveryForPi,
  intersectSessionTools,
  type WorkerInbound,
} from "@neo-cloud-agent/contracts";
import { CLOUD_SYSTEM_PROMPT, createPiCloudTools, sessionToolNames } from "./cloud-tools.js";
import { readExpertWorkspace } from "./expert-workspace.js";
import { getWorkerConfig } from "./config.js";
import { inboundPrompt } from "./images.js";
import { gatewayModelSpec } from "./model-spec.js";
import { abortNestedSubagents, executeNestedSubagent, type SubagentEventHandler } from "./subagent.js";
import { createWorkspaceLoader, summarizeWorkspaceResources } from "./workspace-loader.js";

export interface OpenSessionInput {
  cwd: string;
  sessionDir: string;
  runId: string;
  jwt: string;
  gatewayUrl: string;
  modelId: string;
  controlPlaneUrl?: string;
  tools?: string[];
  systemPrompt?: string;
  allowSubagent?: boolean;
  onSubagentEvent?: SubagentEventHandler;
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

  const spec = gatewayModelSpec(input.modelId);
  modelRuntime.registerProvider("neo-gateway", {
    name: "Neo LLM Gateway",
    baseUrl: `${input.gatewayUrl.replace(/\/$/, "")}/v1`,
    api: "openai-completions",
    models: [
      {
        id: spec.id,
        name: spec.name,
        api: "openai-completions",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: spec.contextWindow,
        maxTokens: spec.maxTokens,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      },
    ],
  });
  await modelRuntime.setRuntimeApiKey("neo-gateway", input.jwt);

  const model = modelRuntime.getModel("neo-gateway", spec.id);
  if (!model) {
    throw new Error(`failed to register gateway model ${input.modelId}`);
  }

  const config = getWorkerConfig();
  const allowSubagent = input.allowSubagent !== false;
  const expert = readExpertWorkspace(input.cwd, config.scratchDir);
  const toolNames = intersectSessionTools(
    input.tools ?? sessionToolNames({ includeSubagent: allowSubagent }),
    expert.tools,
  );
  const customTools = createPiCloudTools({
    runId: input.runId,
    jwt: input.jwt,
    controlPlaneUrl: input.controlPlaneUrl ?? config.controlPlaneUrl,
    workspaceDir: input.cwd,
    runSubagent: allowSubagent
      ? (params) =>
          executeNestedSubagent({
            ...input,
            params,
          })
      : undefined,
  }).filter((tool) => toolNames.includes(tool.name));

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: spec.compactionEnabled },
    retry: { enabled: true, maxRetries: 2 },
  });
  const resourceLoader = await createWorkspaceLoader({
    cwd: input.cwd,
    agentDir,
    systemPrompt: appendProjectInstruction(
      appendExpertRole(
        appendWorkspaceBoundary(input.systemPrompt ?? CLOUD_SYSTEM_PROMPT, config.sandboxRoot),
        expert.role,
      ),
      readProjectInstruction(input.cwd),
    ),
    settingsManager,
    sandboxRoot: config.sandboxRoot,
  });
  const loaded = summarizeWorkspaceResources(resourceLoader);
  if (loaded.skills.length > 0 || loaded.agentsFiles.length > 0) {
    console.log(
      `workspace resources skills=${loaded.skills.join(",") || "-"} agents=${loaded.agentsFiles.length}`,
    );
  }

  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir,
    model,
    thinkingLevel: "off",
    modelRuntime,
    resourceLoader,
    tools: toolNames,
    customTools,
    sessionManager: SessionManager.create(input.cwd, input.sessionDir),
    settingsManager,
  });
  return session;
}

/** Desk runs live in the user's own folder, so say so before the agent guesses. */
function appendWorkspaceBoundary(prompt: string, sandboxRoot: string): string {
  if (!sandboxRoot) {
    return prompt;
  }
  return [
    prompt,
    "",
    "## 本机工作区",
    "",
    `你在用户自己的电脑上，工作区是 \`${sandboxRoot}\`。这里面的文件就是用户正在编辑的文件，包括还没提交的改动。`,
    "只读写这个文件夹里的内容。不要碰家目录、系统目录，或工作区之外的路径。",
  ].join("\n");
}

function readProjectInstruction(cwd: string): string {
  try {
    return readFileSync(path.join(cwd, ".neo", "PROJECT.md"), "utf8");
  } catch {
    return process.env.NEO_PROJECT_INSTRUCTION ?? "";
  }
}

export async function dispatchInbound(session: AgentSession, message: WorkerInbound): Promise<"continue" | "stop"> {
  if (message.type === "shutdown") {
    abortNestedSubagents();
    await session.abort();
    return "stop";
  }
  if (message.type === "abort") {
    abortNestedSubagents();
    await session.abort();
    return "continue";
  }
  if (message.type === "set_model") {
    return "continue";
  }

  const method = deliveryForPi(message.type);
  const config = getWorkerConfig();
  const { text, images } = inboundPrompt(config.workspaceDir, message, config.scratchDir);
  const vision = images.length ? images : undefined;
  if (session.isStreaming) {
    if (method === "steer") {
      await session.steer(text, vision);
    } else {
      await session.followUp(text, vision);
    }
    return "continue";
  }
  await session.prompt(text, vision ? { images: vision } : undefined);
  return "continue";
}

export function describeDispatch(message: WorkerInbound): string {
  const config = getWorkerConfig();
  if (message.type === "shutdown" || message.type === "abort" || message.type === "set_model") {
    return message.type;
  }
  return `session.${deliveryForPi(message.type)} cwd=${config.workspaceDir}`;
}

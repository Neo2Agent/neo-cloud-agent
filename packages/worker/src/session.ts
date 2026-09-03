import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  createAgentSession,
  ModelRuntime,
  SettingsManager,
  type AgentSession,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import {
  appendExpertRole,
  appendProjectInstruction,
  appendUserMemory,
  deliveryForPi,
  intersectSessionTools,
  MEMORY_FILE,
  NEO_DIR,
  wrapPromptWithConversationReplay,
  type WorkerInbound,
} from "@neo-cloud-agent/contracts";
import { expertDocRoots } from "@neo-cloud-agent/extensions";
import { CLOUD_SYSTEM_PROMPT, createPiCloudTools, sessionToolNames } from "./cloud-tools.js";
import { readExpertWorkspace } from "./expert-workspace.js";
import { getWorkerConfig } from "./config.js";
import { inboundPrompt } from "./images.js";
import { gatewayModelSpec } from "./model-spec.js";
import { abortNestedSubagents, executeNestedSubagent, type SubagentEventHandler } from "./subagent.js";
import { resumeOrCreateSessionManager } from "./session-resume.js";
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

/**
 * The neo-side layers of the system prompt, each holding only the text that
 * layer added. pi later concatenates AGENTS.md and the skills catalog onto the
 * same string, so this is the only way to attribute those layers to a bucket.
 */
export interface PromptLayers {
  base: string;
  boundary: string;
  expertRole: string;
  projectInstruction: string;
  userMemory: string;
}

/** Everything the context-usage panel needs that the pi session does not expose. */
export interface SessionContextSources {
  resourceLoader: ResourceLoader;
  promptLayers: PromptLayers;
}

export interface OpenedSession {
  session: AgentSession;
  contextSources: SessionContextSources;
}

/**
 * Each append helper returns `${prompt}\n\n<section>`, so slicing off the
 * previous length recovers exactly what that layer contributed without
 * duplicating the helpers' formatting.
 */
function composeSystemPrompt(input: {
  base: string;
  sandboxRoot: string;
  expertRole: string;
  projectInstruction: string;
  userMemory: string;
}): { text: string; layers: PromptLayers } {
  const { base } = input;
  const withBoundary = appendWorkspaceBoundary(base, input.sandboxRoot);
  const withExpert = appendExpertRole(withBoundary, input.expertRole);
  const withProject = appendProjectInstruction(withExpert, input.projectInstruction);
  const withMemory = appendUserMemory(withProject, input.userMemory);
  return {
    text: withMemory,
    layers: {
      base,
      boundary: withBoundary.slice(base.length),
      expertRole: withExpert.slice(withBoundary.length),
      projectInstruction: withProject.slice(withExpert.length),
      userMemory: withMemory.slice(withProject.length),
    },
  };
}

export async function openPiSession(input: OpenSessionInput): Promise<OpenedSession> {
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
  const scratchDir = config.scratchDir || undefined;
  const expert = readExpertWorkspace(input.cwd, scratchDir);
  const toolNames = intersectSessionTools(
    input.tools ?? sessionToolNames({ includeSubagent: allowSubagent }),
    expert.tools,
  );
  const customTools = createPiCloudTools({
    runId: input.runId,
    jwt: input.jwt,
    controlPlaneUrl: input.controlPlaneUrl ?? config.controlPlaneUrl,
    workspaceDir: input.cwd,
    scratchDir,
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
  const composed = composeSystemPrompt({
    base: input.systemPrompt ?? CLOUD_SYSTEM_PROMPT,
    sandboxRoot: config.sandboxRoot,
    expertRole: expert.role,
    projectInstruction: readProjectInstruction(input.cwd),
    userMemory: readUserMemory(input.cwd),
  });
  const resourceLoader = await createWorkspaceLoader({
    cwd: input.cwd,
    agentDir,
    systemPrompt: composed.text,
    settingsManager,
    sandboxRoot: config.sandboxRoot,
    scratchDir,
  });
  const loaded = summarizeWorkspaceResources(resourceLoader);
  const pluginNames = readPluginSnapshot(input.cwd, scratchDir);
  if (loaded.skills.length > 0 || loaded.agentsFiles.length > 0 || pluginNames.length > 0) {
    console.log(
      `workspace resources skills=${loaded.skills.join(",") || "-"} agents=${loaded.agentsFiles.length} plugins=${pluginNames.join(",") || "-"}`,
    );
  }

  const opened = resumeOrCreateSessionManager(input.cwd, input.sessionDir);
  console.log(
    `pi session ${opened.resumed ? "resumed" : "created"} file=${opened.file ?? "new"} cwd=${input.cwd}`,
  );
  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir,
    model,
    thinkingLevel: "off",
    modelRuntime,
    resourceLoader,
    tools: toolNames,
    customTools,
    sessionManager: opened.manager,
    settingsManager,
  });
  return { session, contextSources: { resourceLoader, promptLayers: composed.layers } };
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
    `你在用户自己的电脑上，工作区是用户选的文件夹 \`${sandboxRoot}\`。这里面的文件就是用户正在编辑的文件，包括还没提交的改动。`,
    "`.neo` 和云端同一套：environment、hooks、skills、agents、专家文件都用这份布局。不要改 `.neo`——同一文件夹里可能还有另一条对话，改了会串。",
    "只读写这个文件夹里的内容。不要碰家目录、系统目录，或工作区之外的路径。不要在工作区里链到家目录或 `/tmp`。要改 git 配置就用 git 命令，并先说明你打算做什么。",
  ].join("\n");
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function warnWorkspaceRead(fileName: string, error: unknown): void {
  const code = error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : "unknown";
  console.warn(`workspace: skip ${NEO_DIR}/${fileName} code=${code}`);
}

function readProjectInstruction(cwd: string): string {
  try {
    return readFileSync(path.join(cwd, NEO_DIR, "PROJECT.md"), "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return process.env.NEO_PROJECT_INSTRUCTION ?? "";
    }
    warnWorkspaceRead("PROJECT.md", error);
    return process.env.NEO_PROJECT_INSTRUCTION ?? "";
  }
}

export function readUserMemory(cwd: string): string {
  try {
    return readFileSync(path.join(cwd, NEO_DIR, MEMORY_FILE), "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return "";
    }
    warnWorkspaceRead(MEMORY_FILE, error);
    return "";
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
  const replayed = applyConversationReplay(session, text, inboundConversationReplay(message));
  const vision = images.length ? images : undefined;
  if (session.isStreaming) {
    if (method === "steer") {
      await session.steer(replayed, vision);
    } else {
      await session.followUp(replayed, vision);
    }
    return "continue";
  }
  await session.prompt(replayed, vision ? { images: vision } : undefined);
  return "continue";
}

function inboundConversationReplay(message: WorkerInbound): string | undefined {
  if (message.type === "prompt" || message.type === "steer" || message.type === "follow_up") {
    return message.conversationReplay;
  }
  return undefined;
}

export function sessionHasConversation(session: Pick<AgentSession, "messages">): boolean {
  try {
    return session.messages.some((message) => {
      const role = (message as { role?: string }).role;
      return role === "user" || role === "assistant";
    });
  } catch {
    return false;
  }
}

/** Only inject transcript when the live pi session has no turns (restore missed). */
export function applyConversationReplay(
  session: Pick<AgentSession, "messages">,
  text: string,
  replay?: string,
): string {
  if (!replay?.trim() || sessionHasConversation(session)) {
    return text;
  }
  return wrapPromptWithConversationReplay(text, replay);
}

function readPluginSnapshot(cwd: string, scratchDir?: string): string[] {
  for (const root of expertDocRoots(cwd, scratchDir)) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(root, "plugins.json"), "utf8")) as { plugins?: Array<{ slug?: string }> };
      const names = Array.isArray(parsed.plugins)
        ? parsed.plugins.map((item) => item.slug).filter((item): item is string => Boolean(item))
        : [];
      if (names.length > 0) {
        return names;
      }
    } catch {
      // Missing or invalid plugins.json — try the next root.
    }
  }
  return [];
}

export function describeDispatch(message: WorkerInbound): string {
  const config = getWorkerConfig();
  if (message.type === "shutdown" || message.type === "abort" || message.type === "set_model") {
    return message.type;
  }
  return `session.${deliveryForPi(message.type)} cwd=${config.workspaceDir}`;
}

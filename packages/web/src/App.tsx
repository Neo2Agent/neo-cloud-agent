import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyRunEventsToMessages,
  DEFAULT_TRANSCRIPT_PAGE,
  displayTranscriptMessages,
  settleTranscriptMessages,
} from "@neo-cloud-agent/contracts/transcript";
import type { RunEvent, TranscriptMessage, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import { decodeExpertPick, encodeExpertPick, expertPickerLabel, type Expert, type ExpertPick, type ExpertTeam } from "@neo-cloud-agent/contracts/expert";
import type { AgentMode, ImageRef, Run } from "@neo-cloud-agent/contracts/run";
import type { Desk, DeskWorkspace } from "@neo-cloud-agent/contracts/desk";
import { api, hydrateDeskToken, readJson, readToken, writeToken } from "./api";
import { hasSavedSession } from "./session";
import { deskBridge, isDeskApp, withApiBase, type DeskTarget } from "./desk";
import { remoteControlSendLock } from "./desk-live";
import { readPinnedRuns, togglePinnedRun } from "./pins";
import { readLastRunId, readLastTarget, writeLastRunId, writeLastTarget } from "./prefs";
import { cloudSafeRepoUrls, isLocalFolderRef } from "./repo";
import { cycle, shortcutAction } from "./shortcuts";
import { applyLiveEvents, parseSseData } from "./stream-apply";
import { AuthGate, type AuthMode } from "./components/AuthGate";
import { ChatErrorBoundary } from "./components/ChatErrorBoundary";
import { ArtifactsPanel } from "./components/ArtifactsPanel";
import { DiffPanel } from "./components/DiffPanel";
import { FileTree } from "./components/FileTree";
import { TerminalPanel } from "./components/TerminalPanel";
import { AutomationsPage } from "./components/AutomationsPage";
import { ExpertsPage } from "./components/ExpertsPage";
import { SkillsPage } from "./components/SkillsPage";
import { ProjectsPage } from "./components/ProjectsPage";
import { MemoriesPage } from "./components/MemoriesPage";
import { SettingsPanel, type BuildOption, type EnvOption, type LlmSettings, type ScmSettings } from "./components/SettingsPanel";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { ProjectAsset } from "@neo-cloud-agent/contracts/project-asset";
import { BUNDLED_RECIPES, recipeById, type IntentCapsule, type Recipe } from "@neo-cloud-agent/contracts/recipe";
import { pluginPickerLabel, type PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import { InboxBell } from "./components/InboxBell";
import { BuddyHome, BuddyPlusSheet, buddySkillsFromRecipes, Tooltip, type BuddyPlusAction } from "@neo-cloud-agent/ui";
import { Composer, readImageRef } from "./components/Composer";
import {
  IconArchive,
  IconTrash,
  IconArtifacts,
  IconAutomations,
  IconChat,
  IconClose,
  IconDiff,
  IconExperts,
  IconFiles,
  IconGear,
  IconMemory,
  IconMenu,
  IconMore,
  IconPr,
  IconProjects,
  IconSidebarClose,
  IconSkills,
  IconTerminal,
} from "./icons";
import { Sidebar, type VmSlotView } from "./components/Sidebar";
import { Transcript } from "./components/Transcript";
import { TranscriptSearch } from "./components/TranscriptSearch";
import { VmSlots } from "./components/VmSlots";
import type { ComposerMention } from "./mention";
import {
  baselineContextUsage,
  overlayContextUsage,
  parseContextUsage,
  resolveModelLimits,
} from "@neo-cloud-agent/contracts/context-usage";
import { formatUsage, modelLabel, preview, resolveChatModel, shortId, slotLabel } from "./format";
import {
  activityLabel,
  isActiveRunStatus,
  isAssistantStreaming,
  isComposerClosed,
  isTerminalTurnEvent,
  isTurnBusy,
  pendingUserArrived,
  runningToolName,
  shouldRefreshTranscript,
  shouldShowBuddyHome,
  statusFromEventKind,
  turnStatusLabel,
  withPendingUser,
  withQueuedNotice,
  type PendingUser,
} from "./turn";
import { NARROW_MQ, closeMobileSidebar, isNarrowViewport } from "./viewport";

const HISTORY_PAGE = DEFAULT_TRANSCRIPT_PAGE;

function localErrorMessage(runId: string | null, title: string): TranscriptMessage {
  return {
    id: `err-${Date.now()}`,
    role: "setup",
    text: title,
    createdAt: new Date().toISOString(),
    kind: "run.error",
    level: "error",
  };
}

function mergeMessages(older: TranscriptMessage[], newer: TranscriptMessage[]): TranscriptMessage[] {
  if (older.length === 0) return newer;
  const seen = new Set(newer.map((item) => item.id));
  return [...older.filter((item) => !seen.has(item.id)), ...newer];
}

type VmSummary = {
  total: number;
  busy: number;
  backend: string;
  slots: VmSlotView[];
};

type Health = {
  ok?: boolean;
  authRequired?: boolean;
  accountsRequired?: boolean;
  bootstrapEmail?: string;
  bootstrapLogin?: boolean;
  defaultAdmin?: boolean;
  llmConfigured?: boolean;
  llmUpstream?: string;
  llmModel?: string | null;
  newApi?: { url?: string | null; consoleUrl?: string | null };
  workerRuntime?: string;
  objectStore?: string;
  scmPush?: ScmSettings;
  workerMemoryMiB?: number;
  vmSlots?: VmSummary;
};

type PullRequest = { url?: string; draft?: boolean };

function formatHealth(health: Health | null, vms: VmSummary): string {
  if (!health?.ok) return "控制面异常";
  const provider = health.newApi?.consoleUrl || health.newApi?.url
    ? `New API · ${modelLabel(health.llmUpstream, health.llmModel)}`
    : health.llmConfigured
      ? modelLabel(health.llmUpstream, health.llmModel)
      : "未配置 Key";
  const total = vms.total || health.vmSlots?.total || 0;
  const busy = vms.busy ?? health.vmSlots?.busy ?? 0;
  const vm = total > 0 ? ` · VM ${busy}/${total}` : health.workerRuntime === "vm" ? " · VM" : "";
  const scm = health.scmPush?.configured ? " · GitHub" : "";
  return `在线 · ${provider}${vm}${scm}`;
}

function hashRunId(): string | null {
  return /^#\/runs\/([^/]+)$/.exec(location.hash)?.[1] ?? null;
}

function hashAutomations(): boolean {
  return location.hash === "#/automations";
}

function hashInviteToken(): string | null {
  return /^#\/invite\/([^/]+)$/.exec(location.hash)?.[1] ?? null;
}

function hashProjectId(): string | null {
  return /^#\/projects\/([^/]+)$/.exec(location.hash)?.[1] ?? null;
}

function hashProjects(): boolean {
  return location.hash === "#/projects" || Boolean(hashProjectId()) || Boolean(hashInviteToken());
}

function hashExpertId(): string | null {
  return /^#\/experts\/([^/]+)$/.exec(location.hash)?.[1] ?? null;
}

function hashExperts(): boolean {
  return location.hash === "#/experts" || Boolean(hashExpertId());
}

function hashSkillId(): string | null {
  return /^#\/skills\/([^/]+)$/.exec(location.hash)?.[1] ?? null;
}

function hashSkills(): boolean {
  return location.hash === "#/skills" || Boolean(hashSkillId());
}

function hashMemories(): boolean {
  return location.hash === "#/memories";
}

function initialMainTab(): "chat" | "automations" | "projects" | "experts" | "skills" | "memories" {
  if (hashAutomations()) return "automations";
  if (hashProjects()) return "projects";
  if (hashExperts()) return "experts";
  if (hashSkills()) return "skills";
  if (hashMemories()) return "memories";
  return "chat";
}

function runRoleLabel(run: Run | null, experts: Expert[], teams: ExpertTeam[]): string {
  if (!run) return "";
  if (run.expertTeamId) {
    return teams.find((item) => item.id === run.expertTeamId || item.slug === run.expertTeamId)?.name ?? "专家团";
  }
  if (run.expertId) {
    const expert = experts.find((item) => item.id === run.expertId || item.slug === run.expertId);
    return expert ? expertPickerLabel(expert) : "专家";
  }
  return "";
}

export function App() {
  const [token, setToken] = useState(readToken);
  const [runs, setRuns] = useState<Run[]>([]);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthText, setHealthText] = useState("检测服务…");
  const [vms, setVms] = useState<VmSummary>({ total: 0, busy: 0, backend: "none", slots: [] });
  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [authOpen, setAuthOpen] = useState(() => !hasSavedSession(readToken()));
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPhone, setAuthPhone] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<ImageRef[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [diffStat, setDiffStat] = useState("");
  const [diffPatch, setDiffPatch] = useState("");
  const [repo, setRepo] = useState("");
  const [envId, setEnvId] = useState("");
  const [buildId, setBuildId] = useState("");
  const [environments, setEnvironments] = useState<EnvOption[]>([]);
  const [builds, setBuilds] = useState<BuildOption[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionTab, setSessionTab] = useState<"chat" | "files" | "diff" | "terminal" | "artifacts">("chat");
  const [agentMode, setAgentMode] = useState<AgentMode>("agent");
  const [deskTarget, setDeskTarget] = useState<DeskTarget>({ kind: "cloud" });
  const [deskFolder, setDeskFolder] = useState("");
  const [desks, setDesks] = useState<Desk[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => (typeof window === "undefined" ? [] : readPinnedRuns()));
  const [diagLogs, setDiagLogs] = useState<Array<{ name: string; content?: string }>>([]);
  const [diagError, setDiagError] = useState("");
  const [diagLoading, setDiagLoading] = useState(false);
  const [artifacts, setArtifacts] = useState<Array<{ name: string; url?: string; contentType?: string }>>([]);
  const [artifactsError, setArtifactsError] = useState("");
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [handoffError, setHandoffError] = useState("");
  const [mainTab, setMainTab] = useState<"chat" | "automations" | "projects" | "experts" | "skills" | "memories">(initialMainTab);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(hashSkillId);
  const [pluginPick, setPluginPick] = useState<PluginCatalogItem | null>(null);
  const [pluginCatalog, setPluginCatalog] = useState<PluginCatalogItem[]>([]);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [selectedExpertId, setSelectedExpertId] = useState<string | null>(hashExpertId);
  const [experts, setExperts] = useState<Expert[]>([]);
  const [teams, setTeams] = useState<ExpertTeam[]>([]);
  const [expertPick, setExpertPick] = useState<ExpertPick>({});
  const [activeProject, setActiveProject] = useState<{ id: string; name: string } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(hashProjectId);
  const [inviteToken, setInviteToken] = useState<string | null>(hashInviteToken);
  const [llm, setLlm] = useState<LlmSettings>({ configured: false, upstream: "deepseek", model: null });
  const [llmKey, setLlmKey] = useState("");
  const [scm, setScm] = useState<ScmSettings>({ configured: false, method: "none" });
  const [scmToken, setScmToken] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<PendingUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem("neo.sidebar");
    if (saved === "0") return false;
    if (saved === "1") return true;
    return window.innerWidth >= 860;
  });
  const [narrow, setNarrow] = useState(() => isNarrowViewport());
  const [moreOpen, setMoreOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const imagePickRef = useRef<HTMLInputElement>(null);
  const cameraPickRef = useRef<HTMLInputElement>(null);
  const topMoreRef = useRef<HTMLDetailsElement>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const streamFrameRef = useRef(0);
  const streamTimerRef = useRef(0);
  const lastEventIdRef = useRef<string | null>(null);
  const lastSseAtRef = useRef(0);
  const appliedEventIdsRef = useRef<Set<string>>(new Set());
  const openGenRef = useRef(0);
  const listenRef = useRef<(id: string, after?: string | null) => void>(() => undefined);
  const tokenRef = useRef(token);
  const sendingRef = useRef(false);
  const pendingRef = useRef<PendingUser | null>(null);
  const keepPendingRef = useRef(false);
  const currentStatusRef = useRef<string | null | undefined>(null);
  const projectNamesRef = useRef(projectNames);
  tokenRef.current = token;
  sendingRef.current = sending;
  pendingRef.current = pendingTurn;
  currentStatusRef.current = currentRun?.status;
  projectNamesRef.current = projectNames;

  const selectedModel = currentRun?.model || resolveChatModel(llm.upstream, llm.model);
  const contextUsage = useMemo(() => {
    const reported = parseContextUsage(currentRun?.contextUsage ?? null);
    const base = reported ?? baselineContextUsage(selectedModel);
    const catalogWindow = resolveModelLimits(base.model || selectedModel)?.contextWindow ?? null;
    const contextWindow = base.contextWindow ?? catalogWindow;
    const streaming = messages.find((message) => message.streaming)?.text ?? "";
    return overlayContextUsage(
      {
        ...base,
        model: base.model || selectedModel,
        contextWindow,
        percent: contextWindow ? (base.tokens / contextWindow) * 100 : null,
      },
      { draft: prompt, streaming },
    );
  }, [currentRun?.contextUsage, prompt, selectedModel, messages]);

  const applyVms = useCallback((payload?: Partial<VmSummary> | null) => {
    if (!payload) return;
    setVms({
      total: payload.total || 0,
      busy: payload.busy || 0,
      backend: payload.backend || "none",
      slots: payload.slots || [],
    });
  }, []);

  const persistToken = useCallback((next: string) => {
    writeToken(next);
    setToken(next);
  }, []);

  const closeStream = useCallback(() => {
    if (streamFrameRef.current) {
      cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = 0;
    }
    if (streamTimerRef.current) {
      window.clearTimeout(streamTimerRef.current);
      streamTimerRef.current = 0;
    }
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const patchRun = useCallback((id: string, patch: (run: Run) => Run) => {
    setCurrentRun((run) => (run && run.id === id ? patch(run) : run));
    setRuns((prev) => prev.map((run) => (run.id === id ? patch(run) : run)));
  }, []);

  const listen = useCallback(
    (id: string, after?: string | null) => {
      closeStream();
      const params = new URLSearchParams();
      const cursor = after ?? lastEventIdRef.current;
      if (cursor) params.set("after", cursor);
      if (tokenRef.current) params.set("access_token", tokenRef.current);
      const query = params.toString() ? `?${params}` : "";
      const source = new EventSource(withApiBase(`/v1/runs/${id}/events${query}`));
      const pending: RunEvent[] = [];
      const flush = () => {
        streamFrameRef.current = 0;
        if (streamTimerRef.current) {
          window.clearTimeout(streamTimerRef.current);
          streamTimerRef.current = 0;
        }
        if (sourceRef.current !== source) {
          return;
        }
        const batch = applyLiveEvents([], pending.splice(0));
        if (batch.length === 0) {
          return;
        }
        setMessages((prev) => {
          const next = applyRunEventsToMessages(prev, batch);
          return batch.some((event) => isTerminalTurnEvent(event.kind))
            ? settleTranscriptMessages(next)
            : next;
        });
        for (const event of batch) {
          const nextStatus = statusFromEventKind(event.kind, undefined);
          if (nextStatus || event.kind === "user.message" || event.kind === "followup.queued" || event.kind === "agent.end") {
            patchRun(id, (run) => {
              const status = statusFromEventKind(event.kind, run.status);
              return status ? { ...run, status: status as Run["status"] } : run;
            });
          }
          if (isTerminalTurnEvent(event.kind)) {
            setStopping(false);
            setSending(false);
            if (event.kind === "run.idle" || event.kind === "agent.end") {
              void deskBridge()?.notify("对话已完成", preview(currentRun?.prompt ?? "Neo"));
            }
            if (event.kind === "run.error") {
              void deskBridge()?.notify("对话出错", event.title || "Run error");
            }
          }
          if (event.kind === "scm.pr_opened" && event.data?.url) {
            patchRun(id, (run) => ({
              ...run,
              pullRequests: [{ url: String(event.data?.url), draft: event.data?.draft !== false, repoUrl: "", branch: "", number: null, title: "" }],
            }));
          }
          if (event.kind === "context.usage") {
            const parsed = parseContextUsage(event.data);
            if (parsed) {
              patchRun(id, (run) => ({ ...run, contextUsage: parsed }));
            }
          }
          if (event.kind === "llm.usage") {
            patchRun(id, (run) => {
              const promptTokens = Number(event.data?.promptTokens ?? 0);
              const completionTokens = Number(event.data?.completionTokens ?? 0);
              const totalTokens = Number(event.data?.totalTokens ?? promptTokens + completionTokens);
              const prev = run.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
              return {
                ...run,
                usage: {
                  promptTokens: prev.promptTokens + promptTokens,
                  completionTokens: prev.completionTokens + completionTokens,
                  totalTokens: prev.totalTokens + totalTokens,
                },
              };
            });
          }
        }
      };
      source.onopen = () => {
        lastSseAtRef.current = Date.now();
      };
      source.onmessage = (message) => {
        lastSseAtRef.current = Date.now();
        const event = parseSseData(message.data);
        if (!event || appliedEventIdsRef.current.has(event.id)) {
          return;
        }
        appliedEventIdsRef.current.add(event.id);
        lastEventIdRef.current = event.id;
        pending.push(event);
        if (streamFrameRef.current || streamTimerRef.current) {
          return;
        }
        if (typeof document !== "undefined" && document.hidden) {
          streamTimerRef.current = window.setTimeout(flush, 16);
          return;
        }
        streamFrameRef.current = requestAnimationFrame(flush);
      };
      source.onerror = () => {
        setHealthText("事件流已断开，正在重试");
        if (source.readyState !== EventSource.CLOSED) {
          return;
        }
        window.setTimeout(() => {
          if (sourceRef.current === source) {
            listenRef.current(id, lastEventIdRef.current);
          }
        }, 750);
      };
      sourceRef.current = source;
    },
    [closeStream, patchRun],
  );
  listenRef.current = listen;

  const refreshVms = useCallback(async () => {
    if (!tokenRef.current) return;
    try {
      const response = await api(tokenRef.current, "/v1/vms");
      if (response.ok) applyVms(await readJson<VmSummary>(response));
    } catch {
      // keep last occupancy
    }
  }, [applyVms]);

  /** Machines the user registered from Desk, so a run can be sent to one. */
  const refreshDesks = useCallback(async () => {
    if (!tokenRef.current) return;
    try {
      const response = await api(tokenRef.current, "/v1/desks");
      if (!response.ok) return;
      const list = (await readJson<{ desks?: Desk[] }>(response)).desks ?? [];
      setDesks(list);
      // A machine re-registers with a new id, so a target saved in this browser
      // can point at one that no longer exists. Sending to it fails with
      // 本机未登记, which reads like a bug rather than a stale pick.
      setDeskTarget((prev) => {
        if (prev.kind !== "desk" || !prev.deskId || deskBridge()?.canRunLocal) {
          return prev;
        }
        const stillThere = list.some(
          (desk) =>
            desk.id === prev.deskId &&
            (!prev.workspaceId || (desk.workspaces ?? []).some((ws) => ws.id === prev.workspaceId)),
        );
        if (stillThere) {
          return prev;
        }
        const next = { ...prev, deskId: undefined, workspaceId: undefined };
        writeLastTarget(next);
        return next;
      });
    } catch {
      // keep the last list
    }
  }, []);

  const refreshExperts = useCallback(async (projectId?: string | null) => {
    if (!tokenRef.current) return;
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    try {
      const [expertRes, teamRes, pluginRes, projectRes] = await Promise.all([
        api(tokenRef.current, `/v1/experts${query}`),
        api(tokenRef.current, "/v1/expert-teams"),
        api(tokenRef.current, `/v1/plugins${query}`),
        api(tokenRef.current, "/v1/projects"),
      ]);
      if (expertRes.ok) {
        setExperts((await readJson<{ experts?: Expert[] }>(expertRes)).experts ?? []);
      }
      if (teamRes.ok) {
        setTeams((await readJson<{ teams?: ExpertTeam[] }>(teamRes)).teams ?? []);
      }
      if (pluginRes.ok) {
        setPluginCatalog((await readJson<{ plugins?: PluginCatalogItem[] }>(pluginRes)).plugins ?? []);
      }
      if (projectRes.ok) {
        const projects = (await readJson<{ projects?: Project[] }>(projectRes)).projects ?? [];
        setProjectNames(Object.fromEntries(projects.map((item) => [item.id, item.name])));
      }
    } catch {
      // optional catalog
    }
  }, []);

  const refreshRuns = useCallback(async () => {
    const response = await api(tokenRef.current, "/v1/runs");
    if (!response.ok) return;
    const body = await readJson<{ runs?: Run[] }>(response);
    const incoming = body.runs ?? [];
    setRuns((prev) =>
      incoming.map((run) => {
        const local = prev.find((item) => item.id === run.id);
        if (
          local &&
          isActiveRunStatus(local.status) &&
          !isActiveRunStatus(run.status) &&
          (sendingRef.current || pendingRef.current)
        ) {
          return { ...run, status: local.status };
        }
        return run;
      }),
    );
    setCurrentRun((run) => {
      if (!run) return run;
      const fresh = incoming.find((item) => item.id === run.id);
      if (!fresh) return run;
      if (isActiveRunStatus(run.status) && !isActiveRunStatus(fresh.status) && (sendingRef.current || pendingRef.current)) {
        return { ...run, ...fresh, status: run.status };
      }
      return { ...run, ...fresh };
    });
  }, []);

  const refreshEnvironments = useCallback(async () => {
    try {
      const [envRes, buildRes] = await Promise.all([
        api(tokenRef.current, "/v1/environments"),
        api(tokenRef.current, "/v1/builds"),
      ]);
      if (envRes.ok) {
        const body = await readJson<{ environments?: EnvOption[] }>(envRes);
        setEnvironments(body.environments ?? []);
      }
      if (buildRes.ok) {
        const body = await readJson<{ builds?: BuildOption[] }>(buildRes);
        setBuilds(body.builds ?? []);
      }
    } catch {
      // optional until logged in
    }
  }, []);

  const refreshLlm = useCallback(async () => {
    try {
      const response = await api(tokenRef.current, "/v1/settings/llm");
      if (!response.ok) return;
      const settings = await readJson<LlmSettings & { error?: string }>(response);
      if (!settings.error) {
        setLlm({
          configured: settings.configured,
          upstream: settings.upstream || "deepseek",
          model: settings.model,
          newApi: settings.newApi,
        });
        setLlmKey("");
      }
    } catch {
      // optional
    }
  }, []);

  const refreshScm = useCallback(async () => {
    try {
      const response = await api(tokenRef.current, "/v1/settings/scm");
      if (!response.ok) return;
      const settings = await readJson<ScmSettings & { error?: string }>(response);
      if (!settings.error) {
        setScm({
          configured: settings.configured,
          method: settings.method === "github-app" || settings.method === "pat" ? settings.method : "none",
        });
        setScmToken("");
      }
    } catch {
      // optional
    }
  }, []);

  const resetComposer = useCallback(() => {
    closeStream();
    setRunId(null);
    setCurrentRun(null);
    setMessages([]);
    setRemaining(0);
    setNextBefore(null);
    setLoadingTranscript(false);
    setLoadingOlder(false);
    lastEventIdRef.current = null;
    appliedEventIdsRef.current = new Set();
    setPrompt("");
    setImages([]);
    setSessionTab("chat");
    setDiffStat("");
    setDiffPatch("");
    setDiffError("");
    setSending(false);
    setStopping(false);
    setPendingTurn(null);
    setEnvId("");
    setBuildId("");
    setHighlightId(null);
    setMoreOpen(false);
    setPlusOpen(false);
    history.replaceState(null, "", "/");
  }, [closeStream]);

  const openRun = useCallback(
    async (id: string) => {
      const gen = ++openGenRef.current;
      setRunId(id);
      setLoadingTranscript(true);
      setMessages([]);
      appliedEventIdsRef.current = new Set();
      setRemaining(0);
      setNextBefore(null);
      setStopping(false);
      setSending(false);
      if (!keepPendingRef.current) setPendingTurn(null);
      setMainTab("chat");
      setSessionTab("chat");
      setHighlightId(null);
      history.replaceState(null, "", `/#/runs/${id}`);
      const [runRes, transcriptRes] = await Promise.all([
        api(tokenRef.current, `/v1/runs/${id}`),
        api(tokenRef.current, `/v1/runs/${id}/transcript?limit=${HISTORY_PAGE}`),
      ]);
      if (openGenRef.current !== gen) return false;
      if (!runRes.ok) {
        setLoadingTranscript(false);
        return false;
      }
      const run = await readJson<Run>(runRes);
      if (openGenRef.current !== gen) return false;
      setCurrentRun(run);
      writeLastRunId(id);
      const projectId = run.projectId ?? "";
      if (projectId) {
        const known = projectNamesRef.current[projectId];
        setActiveProject((prev) => ({
          id: projectId,
          name: known || (prev?.id === projectId ? prev.name : "项目对话"),
        }));
      } else {
        setActiveProject(null);
      }
      const firstRepo = run.repoUrls?.[0] ?? "";
      setRepo(!isDeskApp() && isLocalFolderRef(firstRepo) ? "" : firstRepo);
      setEnvId(run.envId ?? "");
      setBuildId(run.buildId ?? "");
      setRuns((prev) => {
        const index = prev.findIndex((item) => item.id === run.id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = { ...next[index], ...run };
          return next;
        }
        return [run, ...prev];
      });
      if (transcriptRes.ok) {
        const transcript = await readJson<{ snapshot?: TranscriptSnapshot }>(transcriptRes);
        if (openGenRef.current !== gen) return false;
        const snapshot = transcript.snapshot;
        const loaded = snapshot?.messages ?? [];
        setMessages(
          withQueuedNotice(isActiveRunStatus(run.status) ? loaded : settleTranscriptMessages(loaded), run.status),
        );
        setRemaining(snapshot?.remaining ?? 0);
        setNextBefore(snapshot?.nextBefore ?? snapshot?.messages?.[0]?.id ?? null);
        lastEventIdRef.current = snapshot?.lastEventId ?? null;
      } else {
        setMessages([]);
        lastEventIdRef.current = null;
      }
      setLoadingTranscript(false);
      lastSseAtRef.current = Date.now();
      listen(run.id, lastEventIdRef.current);
      void refreshVms();
      if (run.executionTarget?.loop === "desk") {
        void refreshDesks();
      }
      return true;
    },
    [listen, refreshDesks, refreshVms],
  );

  const openAutomations = useCallback(() => {
    setMainTab("automations");
    setSettingsOpen(false);
    history.replaceState(null, "", "/#/automations");
  }, []);

  const openExperts = useCallback((id?: string | null) => {
    setMainTab("experts");
    setSettingsOpen(false);
    setSelectedExpertId(id ?? null);
    history.replaceState(null, "", id ? `/#/experts/${id}` : "/#/experts");
  }, []);

  const openSkills = useCallback((id?: string | null) => {
    setMainTab("skills");
    setSettingsOpen(false);
    setSelectedSkillId(id ?? null);
    history.replaceState(null, "", id ? `/#/skills/${id}` : "/#/skills");
  }, []);

  const openMemories = useCallback(() => {
    setMainTab("memories");
    setSettingsOpen(false);
    history.replaceState(null, "", "/#/memories");
  }, []);

  const useSkill = useCallback(
    async (plugin: PluginCatalogItem) => {
      try {
        if (!plugin.installed) {
          const res = await api(tokenRef.current, `/v1/plugins/${plugin.id}/install`, {
            method: "POST",
            body: JSON.stringify({ scope: "user" }),
          });
          if (!res.ok) throw new Error((await readJson<{ error?: string }>(res)).error || "安装失败");
        } else if (!plugin.enabled) {
          const res = await api(tokenRef.current, `/v1/plugins/${plugin.id}/enable`, {
            method: "POST",
            body: JSON.stringify({ enabled: true, scope: plugin.installScope ?? "user" }),
          });
          if (!res.ok) throw new Error((await readJson<{ error?: string }>(res)).error || "启用失败");
        }
      } catch {
        // 仍带上 pluginIds，这次对话会额外启用
      }
      resetComposer();
      setPluginPick(plugin);
      if (plugin.interface?.defaultPrompt?.[0]) {
        setPrompt(plugin.interface.defaultPrompt[0]);
      }
      setMainTab("chat");
    },
    [resetComposer],
  );

  const openProjects = useCallback((id?: string | null, invite?: string | null) => {
    setMainTab("projects");
    setSettingsOpen(false);
    setSelectedProjectId(id ?? null);
    setInviteToken(invite ?? null);
    if (invite) {
      history.replaceState(null, "", `/#/invite/${invite}`);
      return;
    }
    history.replaceState(null, "", id ? `/#/projects/${id}` : "/#/projects");
  }, []);

  const startProjectChat = useCallback(
    (project: Project) => {
      resetComposer();
      setActiveProject({ id: project.id, name: project.name });
      if (project.defaultRepoUrls[0]) setRepo(project.defaultRepoUrls[0]);
      setMainTab("chat");
    },
    [resetComposer],
  );

  const openChat = useCallback(() => {
    setMainTab("chat");
    if (hashAutomations() || hashProjects() || hashExperts() || hashSkills() || hashMemories()) {
      history.replaceState(null, "", runId ? `/#/runs/${runId}` : "/");
    }
  }, [runId]);

  const finishLogin = useCallback(async () => {
    const desk = deskBridge();
    if (desk) {
      await desk.setToken(tokenRef.current).catch(() => undefined);
      const target = await desk.getTarget().catch(() => undefined);
      if (target) {
        setDeskTarget(target);
        if (target.folder) setDeskFolder(target.folder);
      }
    }
    const refreshShell = [
      refreshRuns(),
      refreshEnvironments(),
      refreshLlm(),
      refreshScm(),
      refreshVms(),
      refreshExperts(),
      refreshDesks(),
    ] as const;
    if (hashAutomations()) {
      setMainTab("automations");
      await Promise.all(refreshShell);
      return;
    }
    if (hashExperts()) {
      setMainTab("experts");
      setSelectedExpertId(hashExpertId());
      await Promise.all(refreshShell);
      return;
    }
    if (hashSkills()) {
      setMainTab("skills");
      setSelectedSkillId(hashSkillId());
      await Promise.all(refreshShell);
      return;
    }
    if (hashMemories()) {
      setMainTab("memories");
      await Promise.all(refreshShell);
      return;
    }
    const invite = hashInviteToken();
    const projectId = hashProjectId();
    if (invite || projectId || location.hash === "#/projects") {
      setMainTab("projects");
      setInviteToken(invite);
      setSelectedProjectId(projectId);
      await Promise.all(refreshShell);
      return;
    }
    const match = hashRunId() || readLastRunId();
    await Promise.all([
      refreshRuns(),
      match ? openRun(match) : Promise.resolve(),
      refreshEnvironments(),
      refreshLlm(),
      refreshScm(),
      refreshVms(),
      refreshDesks(),
    ]);
    if (!match && !hashRunId() && !hashProjects() && !hashExperts() && !hashSkills() && !hashMemories()) resetComposer();
  }, [openRun, refreshDesks, refreshEnvironments, refreshExperts, refreshLlm, refreshRuns, refreshScm, refreshVms, resetComposer]);

  const applySession = useCallback(
    async (nextToken: string, user?: { id?: string; email?: string } | null) => {
      if (!nextToken) throw new Error("登录响应缺少会话");
      persistToken(nextToken);
      if (user?.email) {
        setUserEmail(user.email);
        setUserId(user.id ?? "");
        setAuthOpen(false);
        setAuthError("");
        setAuthPassword("");
        return;
      }
      const me = await api(nextToken, "/v1/me");
      if (!me.ok) {
        persistToken("");
        setUserEmail("");
        setUserId("");
        throw new Error("unauthorized");
      }
      const body = await readJson<{ user?: { id?: string; email?: string } }>(me);
      if (!body.user) {
        persistToken("");
        setUserEmail("");
        setUserId("");
        throw new Error("登录未生效，请再试一次");
      }
      setUserEmail(body.user.email ?? "");
      setUserId(body.user.id ?? "");
      setAuthOpen(false);
      setAuthError("");
      setAuthPassword("");
    },
    [persistToken],
  );

  const sendMessage = useCallback(async () => {
    const text = prompt.trim();
    if (!text && images.length === 0) return;
    if (isComposerClosed(currentRun?.status)) return;
    const hostLock = remoteControlSendLock(
      currentRun,
      desks,
      deskBridge()?.canRunLocal ? { thisDeskId: deskTarget.deskId } : undefined,
    );
    if (hostLock.locked) return;
    if (
      isTurnBusy({
        sending: sendingRef.current,
        stopping,
        pending: Boolean(pendingRef.current),
        status: currentRun?.status,
        messages,
      })
    ) {
      return;
    }
    // A browser cannot pick a folder, so 本机 needs a machine chosen first.
    if (!runId && deskTarget.kind === "desk" && !deskBridge()?.canRunLocal && !deskTarget.deskId) {
      setMessages((prev) => [
        ...prev,
        localErrorMessage(runId, "先选一台电脑。要出现在这里，那台电脑得打开 Desk 并在设置里开启 Remote control。"),
      ]);
      return;
    }
    const attached = images;
    const previousStatus = currentRun?.status;
    const askPrefix = agentMode === "ask" ? "只阅读和回答，不要修改文件或执行会改状态的命令。\n\n" : "";
    const pending: PendingUser = {
      id: `pending-${Date.now()}`,
      text: text || "（图片）",
      images: attached.length ? attached : undefined,
      createdAt: new Date().toISOString(),
    };
    setSending(true);
    setPendingTurn(pending);
    setPrompt("");
    setImages([]);
    if (runId && !isActiveRunStatus(currentRun?.status)) {
      patchRun(runId, (run) => ({ ...run, status: "RUNNING" }));
    }
    const repoUrls = deskTarget.kind === "desk" ? (repo.trim() ? [repo.trim()] : deskFolder ? [deskFolder] : []) : cloudSafeRepoUrls(repo.trim() ? [repo.trim()] : []);
    const model = resolveChatModel(llm.upstream, llm.model, attached.length > 0);
    const buildPayload = buildId === "cold" ? { reuseBuild: false } : buildId ? { buildId, reuseBuild: true } : { reuseBuild: true };
    try {
      if (!runId) {
        const created = await readJson<Run & { error?: string }>(
          await api(tokenRef.current, "/v1/runs", {
            method: "POST",
            body: JSON.stringify({
              prompt: `${askPrefix}${text || "（图片）"}`,
              repoUrls,
              source: deskTarget.kind === "desk" ? "desk" : "web",
              envId: envId || undefined,
              model,
              images: attached.length ? attached : undefined,
              projectId: activeProject?.id,
              expertId: expertPick.expertId,
              expertTeamId: expertPick.expertTeamId,
              pluginIds: pluginPick ? [pluginPick.id] : undefined,
              mode: agentMode,
              deskWorkspaceId: deskTarget.kind === "desk" ? deskTarget.workspaceId : undefined,
              target:
                deskTarget.kind === "desk"
                  ? {
                      loop: "desk",
                      tools: "desk",
                      deskId: deskTarget.deskId,
                      deskWorkspaceId: deskTarget.workspaceId,
                    }
                  : { loop: "cloud", tools: "cloud" },
              ...buildPayload,
            }),
          }),
        );
        if (created.error) throw new Error(created.error);
        setRuns((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        keepPendingRef.current = true;
        try {
          const opened = await openRun(created.id);
          if (!opened) throw new Error("打开对话失败");
        } finally {
          keepPendingRef.current = false;
        }
        return;
      }
      const follow = await readJson<{ error?: string }>(
        await api(tokenRef.current, `/v1/runs/${runId}/follow-ups`, {
          method: "POST",
          body: JSON.stringify({
            text: `${askPrefix}${text || "（图片）"}`,
            images: attached.length ? attached : undefined,
          }),
        }),
      );
      if (follow.error) throw new Error(follow.error);
    } catch (error) {
      setPendingTurn(null);
      setPrompt(text);
      setImages(attached);
      if (runId && previousStatus) {
        patchRun(runId, (run) => ({ ...run, status: previousStatus }));
      }
      setMessages((prev) => [...prev, localErrorMessage(runId, error instanceof Error ? error.message : "发送失败")]);
    } finally {
      setSending(false);
    }
  }, [activeProject?.id, agentMode, buildId, currentRun, desks, deskFolder, deskTarget, envId, expertPick.expertId, expertPick.expertTeamId, images, llm.model, llm.upstream, openRun, patchRun, pluginPick, prompt, repo, runId, messages, stopping]);

  const queueMessage = useCallback(async () => {
    const text = prompt.trim();
    if (!text && images.length === 0) return;
    if (isComposerClosed(currentRun?.status) || !runId) return;
    if (
      remoteControlSendLock(
        currentRun,
        desks,
        deskBridge()?.canRunLocal ? { thisDeskId: deskTarget.deskId } : undefined,
      ).locked
    ) {
      return;
    }
    const attached = images;
    const askPrefix = agentMode === "ask" ? "只阅读和回答，不要修改文件或执行会改状态的命令。\n\n" : "";
    setPrompt("");
    setImages([]);
    try {
      const follow = await readJson<{ error?: string }>(
        await api(tokenRef.current, `/v1/runs/${runId}/follow-ups`, {
          method: "POST",
          body: JSON.stringify({
            text: `${askPrefix}${text || "（图片）"}`,
            images: attached.length ? attached : undefined,
          }),
        }),
      );
      if (follow.error) throw new Error(follow.error);
    } catch (error) {
      setPrompt(text);
      setImages(attached);
      setMessages((prev) => [...prev, localErrorMessage(runId, error instanceof Error ? error.message : "排队失败")]);
    }
  }, [agentMode, currentRun, desks, deskTarget.deskId, images, prompt, runId]);

  const stopTurn = useCallback(() => {
    if (!runId) return;
    setStopping(true);
    void (async () => {
      try {
        const response = await api(tokenRef.current, `/v1/runs/${runId}/abort`, { method: "POST" });
        const body = await readJson<Run & { error?: string }>(response);
        if (!response.ok) throw new Error(body.error || "停止失败");
        patchRun(runId, (run) => ({ ...run, ...body }));
        if (!isActiveRunStatus(body.status)) {
          setStopping(false);
          setSending(false);
        }
      } catch {
        setStopping(false);
      }
    })();
  }, [patchRun, runId]);

  const commitWorkspace = useCallback(
    async (message: string) => {
      if (!runId) return;
      setCommitting(true);
      setCommitError("");
      try {
        const body = await readJson<{ error?: string }>(
          await api(tokenRef.current, `/v1/runs/${runId}/commit`, {
            method: "POST",
            body: JSON.stringify({ message }),
          }),
        );
        if (body.error) throw new Error(body.error);
        setDiffLoading(true);
        const response = await api(tokenRef.current, `/v1/runs/${runId}/diff`);
        const diff = await readJson<{ stat?: string; patch?: string; error?: string }>(response);
        if (!response.ok) throw new Error(diff.error || "读取 diff 失败");
        setDiffStat(diff.stat ?? "");
        setDiffPatch(diff.patch ?? "");
      } catch (error) {
        setCommitError(error instanceof Error ? error.message : "提交失败");
      } finally {
        setCommitting(false);
        setDiffLoading(false);
      }
    },
    [runId],
  );

  /** Cloud → This Computer only. A local conversation stays local; see handoffRun. */
  const handoffCurrent = useCallback(
    async (_kind: "desk") => {
      if (!runId) return;
      if (!window.confirm("切到本机。未提交的改动不会带过去，先 commit 或 stash。确定？")) {
        return;
      }
      setHandoffError("");
      try {
        const target = {
          loop: "desk" as const,
          tools: "desk" as const,
          deskId: deskTarget.deskId,
          deskWorkspaceId: deskTarget.workspaceId,
        };
        const body = await readJson<Run & { error?: string }>(
          await api(tokenRef.current, `/v1/runs/${runId}/handoff`, {
            method: "POST",
            body: JSON.stringify({ target, deskWorkspaceId: deskTarget.workspaceId }),
          }),
        );
        if (body.error) throw new Error(body.error);
        setCurrentRun(body);
        setRuns((prev) => prev.map((item) => (item.id === body.id ? { ...item, ...body } : item)));
      } catch (error) {
        setHandoffError(error instanceof Error ? error.message : "移交失败");
      }
    },
    [deskTarget.deskId, runId],
  );

  const applyTarget = useCallback((next: DeskTarget) => {
    setDeskTarget(next);
    if (next.folder) setDeskFolder(next.folder);
    writeLastTarget(next);
    void deskBridge()?.setTarget(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const saved = tokenRef.current;
    void (async () => {
      try {
        const payload = await readJson<Health>(await fetch(withApiBase("/health")));
        if (cancelled) return;
        setHealth(payload);
        setAuthEmail("");
        setAuthPassword("");
        applyVms(payload.vmSlots);
        setHealthText(formatHealth(payload, payload.vmSlots ?? { total: 0, busy: 0, backend: "none", slots: [] }));
      } catch {
        if (!cancelled) setHealthText("控制面不可达");
      }
    })();
    void (async () => {
      const remembered = (await deskBridge()?.getTarget().catch(() => undefined)) ?? readLastTarget();
      if (cancelled) return;
      if (remembered) {
        setDeskTarget(remembered);
        if (remembered.folder) setDeskFolder(remembered.folder);
      }
      const session = (await hydrateDeskToken()) || saved;
      if (cancelled) return;
      persistToken(session);
      if (hasSavedSession(session)) {
        try {
          await applySession(session);
          if (cancelled) return;
          await finishLogin();
        } catch {
          if (cancelled) return;
          persistToken("");
          setAuthError("请重新登录");
          setAuthOpen(true);
        }
        return;
      }
      persistToken("");
      setAuthOpen(true);
    })();
    return () => {
      cancelled = true;
    };
    // boot once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!tokenRef.current) return;
      void (async () => {
        try {
          const payload = await readJson<Health>(await fetch(withApiBase("/health")));
          setHealth(payload);
          applyVms(payload.vmSlots);
          setHealthText(formatHealth(payload, payload.vmSlots ?? { total: 0, busy: 0, backend: "none", slots: [] }));
        } catch {
          // keep last
        }
        if (runId) await refreshRuns();
        await refreshVms();
        await refreshDesks();
      })();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [applyVms, refreshDesks, refreshRuns, refreshVms, runId]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      if (!tokenRef.current) return;
      const status = currentStatusRef.current;
      if (!shouldRefreshTranscript({ lastSseAt: lastSseAtRef.current, status })) return;
      try {
        const [runRes, transcriptRes] = await Promise.all([
          api(tokenRef.current, `/v1/runs/${runId}`),
          api(tokenRef.current, `/v1/runs/${runId}/transcript?limit=${HISTORY_PAGE}`),
        ]);
        if (cancelled) return;
        const fresh = runRes.ok ? await readJson<Run>(runRes) : null;
        if (fresh && fresh.id === runId) {
          setCurrentRun((prev) => (prev && prev.id === fresh.id ? { ...prev, ...fresh } : prev));
          setRuns((prev) => prev.map((item) => (item.id === fresh.id ? { ...item, ...fresh } : item)));
        }
        if (!transcriptRes.ok) return;
        const body = await readJson<{ snapshot?: TranscriptSnapshot }>(transcriptRes);
        const snapshot = body.snapshot;
        if (!snapshot) return;
        const nextStatus = fresh?.status ?? status;
        if (snapshot.lastEventId && snapshot.lastEventId === lastEventIdRef.current) {
          setMessages((prev) => withQueuedNotice(prev, nextStatus));
          return;
        }
        const loaded = snapshot.messages ?? [];
        lastEventIdRef.current = snapshot.lastEventId ?? lastEventIdRef.current;
        setMessages(
          withQueuedNotice(
            isActiveRunStatus(nextStatus) ? loaded : settleTranscriptMessages(loaded),
            nextStatus,
          ),
        );
      } catch {
        // keep the last painted transcript
      }
    };
    const timer = window.setInterval(() => void tick(), 2500);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runId]);

  useEffect(() => () => closeStream(), [closeStream]);

  useEffect(() => {
    const syncHash = () => {
      const invite = hashInviteToken();
      const projectId = hashProjectId();
      if (hashAutomations()) {
        setMainTab("automations");
        setInviteToken(null);
        setSettingsOpen(false);
        return;
      }
      if (hashExperts()) {
        setMainTab("experts");
        setSelectedExpertId(hashExpertId());
        setInviteToken(null);
        setSettingsOpen(false);
        return;
      }
      if (hashSkills()) {
        setMainTab("skills");
        setSelectedSkillId(hashSkillId());
        setInviteToken(null);
        setSettingsOpen(false);
        return;
      }
      if (hashMemories()) {
        setMainTab("memories");
        setInviteToken(null);
        setSettingsOpen(false);
        return;
      }
      if (invite || projectId || location.hash === "#/projects") {
        setMainTab("projects");
        setInviteToken(invite);
        setSelectedProjectId(projectId);
        setSettingsOpen(false);
        return;
      }
      setMainTab("chat");
      setInviteToken(null);
    };
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      const typing = Boolean(el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable));
      const action = shortcutAction(event, deskBridge()?.platform === "darwin" ? "darwin" : "other");
      if (!action) return;
      if (typing && (action === "new-chat" || action === "prev-run" || action === "next-run" || action === "close")) {
        return;
      }
      event.preventDefault();
      if (action === "new-chat") {
        setActiveProject(null);
        setMainTab("chat");
        resetComposer();
        return;
      }
      if (action === "close") {
        resetComposer();
        return;
      }
      if (action === "queue") {
        void queueMessage();
        return;
      }
      if (action === "stop") {
        stopTurn();
        return;
      }
      if (action === "cycle-mode" || action === "mode-menu") {
        setAgentMode((mode) => (mode === "agent" ? "ask" : "agent"));
        return;
      }
      if (action === "cycle-model") {
        setLlm((prev) => {
          const next = cycle(["deepseek-v4-flash", "deepseek-v4-pro"], prev.model || "deepseek-v4-flash");
          return { ...prev, model: next, upstream: "deepseek" };
        });
        return;
      }
      const ordered = [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const index = ordered.findIndex((item) => item.id === runId);
      if (action === "prev-run" && ordered[index + 1]) void openRun(ordered[index + 1]!.id);
      if (action === "next-run" && ordered[index - 1]) void openRun(ordered[index - 1]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openRun, queueMessage, resetComposer, runId, runs, stopTurn]);

  useEffect(() => {
    return deskBridge()?.onDeepLink((url) => {
      const match = /runs\/([^/?#]+)/.exec(url);
      if (match?.[1]) void openRun(match[1]);
    });
  }, [openRun]);

  useEffect(() => {
    if (isNarrowViewport()) setSidebarOpen(false);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(NARROW_MQ);
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useLayoutEffect(() => {
    if (topMoreRef.current) topMoreRef.current.open = !narrow;
  }, [narrow]);

  useEffect(() => {
    if (pendingTurn && pendingUserArrived(messages, pendingTurn)) {
      setPendingTurn(null);
    }
  }, [pendingTurn, messages]);

  useEffect(() => {
    void refreshExperts(activeProject?.id);
  }, [activeProject?.id, refreshExperts]);

  useEffect(() => {
    if (!token || !activeProject) {
      setProjectAssets([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await api(token, `/v1/projects/${encodeURIComponent(activeProject.id)}/assets`);
        if (!response.ok || cancelled) return;
        const body = await readJson<{ assets?: ProjectAsset[] }>(response);
        if (!cancelled) setProjectAssets(body.assets ?? []);
      } catch {
        if (!cancelled) setProjectAssets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, activeProject]);

  useEffect(() => {
    if (!currentRun || isActiveRunStatus(currentRun.status)) {
      return;
    }
    setMessages((prev) => {
      if (!prev.some((message) => message.streaming || message.tools?.some((tool) => tool.status === "running"))) {
        return prev;
      }
      return settleTranscriptMessages(prev);
    });
  }, [currentRun?.id, currentRun?.status]);

  const viewMessages = withPendingUser(messages, pendingTurn);
  const displayMessages = displayTranscriptMessages(viewMessages, {
    hideStaleRestart: true,
  });
  const busy = isTurnBusy({
    sending,
    stopping,
    pending: Boolean(pendingTurn),
    status: currentRun?.status,
    messages: viewMessages,
  });
  const archived = isComposerClosed(currentRun?.status);
  const hostLock = remoteControlSendLock(
    currentRun,
    desks,
    deskBridge()?.canRunLocal ? { thisDeskId: deskTarget.deskId } : undefined,
  );
  const activity = activityLabel({
    sending,
    stopping,
    status: currentRun?.status,
    streaming: isAssistantStreaming(messages),
    runningTool: runningToolName(messages),
  });
  const statusView = turnStatusLabel({ sending, stopping, status: currentRun?.status });
  const pr = currentRun?.pullRequests?.[0] as PullRequest | undefined;
  const currentSlot =
    vms.slots.find((slot) => slot.runId === runId && slot.status === "busy")?.id ||
    (isActiveRunStatus(currentRun?.status) ? currentRun?.vmSlotId : null) ||
    null;
  const vmHint = !vms.total && vms.slots.length === 0
    ? "未启用 VM 槽。"
    : currentSlot
      ? `当前对话占用 ${slotLabel(currentSlot)}（${currentSlot}，${vms.backend === "loop" ? "loop 挂载" : vms.backend}）`
      : Math.max(0, (vms.total || vms.slots.length) - vms.busy) > 0
        ? `${Math.max(0, (vms.total || vms.slots.length) - vms.busy)}/${vms.total || vms.slots.length} 个 VM 空闲，发送后占用其中一个（${vms.backend === "loop" ? "loop 挂载" : vms.backend}）。`
        : `${vms.total || vms.slots.length} 个 VM 都在忙。新对话会排队，有空闲槽再自动开始。`;

  const inspectorOpen = mainTab === "chat" && sessionTab !== "chat";

  const openInspector = (id: "files" | "diff" | "terminal" | "artifacts" | "chat") => {
    setSessionTab(id);
    setSettingsOpen(false);
    if (id === "chat" || !runId) return;
    if (id === "diff") {
      setDiffLoading(true);
      setDiffError("");
      void (async () => {
        const response = await api(token, `/v1/runs/${runId}/diff`);
        const body = await readJson<{ stat?: string; patch?: string; error?: string }>(response);
        if (!response.ok) throw new Error(body.error || "读取 diff 失败");
        setDiffStat(body.stat ?? "");
        setDiffPatch(body.patch ?? "");
      })()
        .catch((error) => setDiffError(error instanceof Error ? error.message : "读取 diff 失败"))
        .finally(() => setDiffLoading(false));
    }
    if (id === "terminal") {
      setDiagLoading(true);
      setDiagError("");
      void (async () => {
        const response = await api(token, `/v1/runs/${runId}/diagnostics`);
        const body = await readJson<{ logs?: Array<{ name: string; content?: string }>; error?: string }>(response);
        if (!response.ok) throw new Error(body.error || "读取日志失败");
        setDiagLogs(body.logs ?? []);
      })()
        .catch((error) => setDiagError(error instanceof Error ? error.message : "读取日志失败"))
        .finally(() => setDiagLoading(false));
    }
    if (id === "artifacts") {
      setArtifactsLoading(true);
      setArtifactsError("");
      void (async () => {
        const response = await api(token, `/v1/runs/${runId}/artifacts`);
        const body = await readJson<{ artifacts?: Array<{ name: string; url?: string; contentType?: string }>; error?: string }>(response);
        if (!response.ok) throw new Error(body.error || "读取产物失败");
        setArtifacts(body.artifacts ?? []);
      })()
        .catch((error) => setArtifactsError(error instanceof Error ? error.message : "读取产物失败"))
        .finally(() => setArtifactsLoading(false));
    }
  };

  const localTargetHint = deskBridge()?.canRunLocal
    ? deskFolder
      ? `本机 · ${deskFolder}`
      : "本机执行需要先选一个文件夹。"
    : (() => {
        const picked = desks
          .flatMap((desk) => (desk.workspaces ?? []).map((ws: DeskWorkspace) => ({ desk, ws })))
          .find((item) => item.ws.id === deskTarget.workspaceId);
        if (picked) {
          return `会在 ${picked.desk.name} 的 ${picked.ws.name} 里跑。`;
        }
        const available = desks.some((desk) => desk.online && desk.allowRemote === true && (desk.workspaces?.length ?? 0) > 0);
        return available
          ? "选一台已打开 Desk 的电脑。"
          : "没有可用的电脑。先打开 Desk 并在设置里绑定一个文件夹。";
      })();

  const composerMentions = useMemo<ComposerMention[]>(() => {
    const expertItems: ComposerMention[] = experts.map((expert) => ({
      kind: "expert",
      id: expert.id,
      label: expert.name,
      insert: `@专家 ${expert.name}`,
    }));
    const teamItems: ComposerMention[] = teams.map((team) => ({
      kind: "team",
      id: team.id,
      label: team.name,
      insert: `@专家团 ${team.name}`,
    }));
    const skillItems: ComposerMention[] = [...pluginCatalog]
      .sort((left, right) => Number(right.enabled) - Number(left.enabled) || Number(right.pinned) - Number(left.pinned))
      .map((plugin) => ({
        kind: "plugin",
        id: plugin.id,
        label: pluginPickerLabel(plugin),
        insert: `@技能 ${pluginPickerLabel(plugin)}`,
      }));
    const assetItems: ComposerMention[] = projectAssets.map((asset) => ({
      kind: "asset",
      id: asset.path,
      label: asset.path.split("/").pop() ?? asset.path,
      insert: `@资产 ${asset.path}`,
    }));
    return [...expertItems, ...teamItems, ...skillItems, ...assetItems];
  }, [experts, teams, pluginCatalog, projectAssets]);

  const applyMention = (item: ComposerMention) => {
    if (item.kind === "expert") {
      setExpertPick({ expertId: item.id });
      return;
    }
    if (item.kind === "team") {
      setExpertPick({ expertTeamId: item.id });
      return;
    }
    if (item.kind === "plugin") {
      const plugin = pluginCatalog.find((entry) => entry.id === item.id);
      if (plugin) setPluginPick(plugin);
    }
  };

  const applyRole = (item: { expertId?: string; expertTeamId?: string; pluginIds?: string[] }) => {
    if (item.expertTeamId) {
      setExpertPick({ expertTeamId: item.expertTeamId });
    } else if (item.expertId) {
      setExpertPick({ expertId: item.expertId });
    }
    const pluginId = item.pluginIds?.[0];
    if (!pluginId) return;
    const plugin = pluginCatalog.find((entry) => entry.id === pluginId || entry.slug === pluginId);
    if (plugin) setPluginPick(plugin);
  };

  const applyCapsule = (capsule: IntentCapsule) => {
    applyRole(capsule);
  };

  const applyRecipe = (recipe: Recipe) => {
    setPrompt(recipe.prompt);
    applyRole(recipe);
    setMoreOpen(false);
    setMainTab("chat");
  };

  const openDraftPr = async () => {
    if (!runId) return;
    try {
      const created = await readJson<{ error?: string; pullRequest?: PullRequest }>(
        await api(token, `/v1/runs/${runId}/pull-request`, {
          method: "POST",
          body: JSON.stringify({ title: currentRun?.prompt || "Agent changes" }),
        }),
      );
      if (created.error) throw new Error(created.error);
      const next = created.pullRequest ?? created;
      setCurrentRun((run) => (run ? { ...run, pullRequests: [next as Run["pullRequests"][number]] } : run));
    } catch (error) {
      setMessages((prev) => [...prev, localErrorMessage(runId, error instanceof Error ? error.message : "开 PR 失败")]);
    }
  };

  const applyBuddyPlus = (action: BuddyPlusAction) => {
    setPlusOpen(false);
    if (action === "image" || action === "file") {
      imagePickRef.current?.click();
      return;
    }
    if (action === "camera") {
      cameraPickRef.current?.click();
      return;
    }
    if (action === "settings" || action === "repo") {
      setSettingsOpen(true);
      return;
    }
    if (action === "memory") {
      openMemories();
      return;
    }
    if (action === "expert") {
      setPrompt((value) => (value.includes("@") ? value : `${value} @`.trimStart()));
      return;
    }
    if (action === "skill") {
      openSkills();
      return;
    }
    if (action === "new") {
      resetComposer();
      setMainTab("chat");
      return;
    }
    if (action === "pr") void openDraftPr();
  };

  const addPickedImages = (files: FileList | null) => {
    const imagesOnly = [...(files ?? [])].filter((file) => file.type.startsWith("image/")).slice(0, 4);
    if (imagesOnly.length === 0) return;
    void Promise.all(imagesOnly.map(readImageRef)).then((next) => {
      setImages((prev) => [...prev, ...next].slice(0, 4));
    });
  };

  const archiveMany = async (ids: string[]) => {
    if (!token || ids.length === 0) return;
    await Promise.allSettled(
      ids.map((id) => api(token, `/v1/runs/${encodeURIComponent(id)}/archive`, { method: "POST" })),
    );
    await refreshRuns();
    if (runId && ids.includes(runId)) {
      setCurrentRun((run) => (run ? { ...run, status: "ARCHIVED" } : run));
    }
  };

  const deleteArchivedRun = async (id: string) => {
    if (!token || !id) return;
    if (!window.confirm("删除后任务会从列表消失，确定？")) return;
    const response = await api(token, `/v1/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await readJson<{ ok?: boolean; error?: string }>(response);
    if (!response.ok) {
      throw new Error(body.error || "删除失败");
    }
    setRuns((prev) => prev.filter((item) => item.id !== id));
    if (runId === id) {
      resetComposer();
    }
    await refreshRuns();
  };

  const openDiagnostics = () => {
    if (!runId) return;
    openInspector("terminal");
  };

  const loadOlder = () => {
    if (!runId || remaining <= 0 || loadingOlder || loadingTranscript) return;
    const before = nextBefore ?? messages[0]?.id;
    if (!before) return;
    setLoadingOlder(true);
    void (async () => {
      try {
        const response = await api(
          tokenRef.current,
          `/v1/runs/${runId}/transcript?limit=${HISTORY_PAGE}&before=${encodeURIComponent(before)}`,
        );
        if (!response.ok) return;
        const body = await readJson<{ snapshot?: TranscriptSnapshot }>(response);
        const older = body.snapshot?.messages ?? [];
        setMessages((prev) => mergeMessages(older, prev));
        setRemaining(body.snapshot?.remaining ?? 0);
        setNextBefore(body.snapshot?.nextBefore ?? older[0]?.id ?? null);
      } finally {
        setLoadingOlder(false);
      }
    })();
  };

  const toggleSidebar = () => {
    if (narrow) topMoreRef.current?.removeAttribute("open");
    setSidebarOpen((value) => {
      const next = !value;
      window.localStorage.setItem("neo.sidebar", next ? "1" : "0");
      return next;
    });
  };

  return (
    <>
      <div className={`${sidebarOpen ? "app" : "app sidebar-closed"}${narrow ? " is-buddy" : ""}`}>
        {sidebarOpen ? <div className="sidebar-backdrop" id="sidebar-backdrop" onClick={toggleSidebar} /> : null}
        <Sidebar
          runs={runs}
          currentRunId={runId}
          userEmail={userEmail}
          authed={Boolean(userEmail)}
          authBusy={authBusy}
          health={healthText}
          pinnedIds={pinnedIds}
          projectNames={projectNames}
          buddy={narrow}
          target={deskTarget.kind === "desk" ? "desk" : "cloud"}
          deskDisabled={!deskBridge()?.canRunLocal && !desks.some((desk) => desk.online && desk.allowRemote === true && (desk.workspaces?.length ?? 0) > 0)}
          onTarget={(value) => applyTarget({ ...deskTarget, kind: value })}
          onOpenNav={(id) => {
            setSidebarOpen(false);
            if (id === "automations") openAutomations();
            if (id === "experts") openExperts();
            if (id === "projects") openProjects();
            if (id === "skills") openSkills();
          }}
          onPin={(id) => setPinnedIds(togglePinnedRun(id))}
          onArchiveMany={(ids) => void archiveMany(ids)}
          onDeleteRun={(id) => {
            void deleteArchivedRun(id).catch((error) => {
              setMessages((prev) => [...prev, localErrorMessage(runId, error instanceof Error ? error.message : "删除失败")]);
            });
          }}
          onClose={narrow ? toggleSidebar : undefined}
          onNewChat={() => {
            setActiveProject(null);
            setMainTab("chat");
            resetComposer();
            setSidebarOpen((open) => {
              if (!closeMobileSidebar()) return open;
              return false;
            });
          }}
          onOpenRun={(id) => {
            setMainTab("chat");
            setSidebarOpen((open) => {
              if (window.innerWidth < 860 && open) {
                window.localStorage.setItem("neo.sidebar", "0");
                return false;
              }
              return open;
            });
            void openRun(id);
          }}
          onLogin={() => {
            setAuthMode("login");
            setAuthEmail("");
            setAuthPassword("");
            setAuthError("");
            setAuthOpen(true);
          }}
          onLogout={() => {
            void api(token, "/v1/auth/logout", { method: "POST" });
            persistToken("");
            setUserEmail("");
            setUserId("");
            setActiveProject(null);
            setAuthEmail("");
            setAuthPassword("");
            setRuns([]);
            resetComposer();
            setAuthOpen(true);
          }}
        />
        <main className="main">
          <header className="topbar">
            <div className="topbar-lead">
              <Tooltip content={sidebarOpen ? "收起侧栏" : "打开对话列表"} side="bottom">
                <button
                  className="icon-btn sidebar-toggle"
                  id="sidebar-toggle"
                  type="button"
                  aria-label={sidebarOpen ? "收起侧栏" : "打开对话列表"}
                  onClick={toggleSidebar}
                >
                  {sidebarOpen ? <IconSidebarClose /> : <IconMenu />}
                  <span className="sidebar-toggle-label">{sidebarOpen ? "收起侧栏" : "对话列表"}</span>
                </button>
              </Tooltip>
              <nav className="app-tabs" id="app-tabs" aria-label="主导航">
                {(
                  [
                    ["chat", "对话", IconChat, openChat],
                    ["projects", "项目", IconProjects, () => openProjects()],
                    ["experts", "专家", IconExperts, () => openExperts()],
                    ["skills", "技能", IconSkills, () => openSkills()],
                    ["memories", "记忆", IconMemory, openMemories],
                    ["automations", "定时任务", IconAutomations, openAutomations],
                  ] as const
                ).map(([id, label, Icon, onClick]) => (
                  <Tooltip key={id} content={label} side="bottom">
                    <button
                      type="button"
                      className={mainTab === id ? "active" : ""}
                      aria-label={label}
                      aria-current={mainTab === id ? "page" : undefined}
                      onClick={onClick}
                    >
                      <Icon size={16} />
                      <span className="tab-label">{label}</span>
                    </button>
                  </Tooltip>
                ))}
              </nav>
              <div className="topbar-heading">
                <p className="eyebrow" id="run-label">
                  {mainTab === "projects"
                    ? "项目"
                    : mainTab === "experts"
                      ? "专家"
                      : mainTab === "skills"
                      ? "技能"
                      : mainTab === "memories"
                      ? "记忆"
                      : mainTab === "automations"
                      ? "定时任务"
                      : currentRun
                        ? [currentRun.branchName ?? shortId(currentRun.id), runRoleLabel(currentRun, experts, teams)]
                            .filter(Boolean)
                            .join(" · ")
                        : expertPick.expertTeamId || expertPick.expertId
                          ? `专家 · ${
                              teams.find((item) => item.id === expertPick.expertTeamId)?.name ||
                              experts.find((item) => item.id === expertPick.expertId)?.name ||
                              "已选"
                            }`
                          : activeProject
                          ? `项目 · ${activeProject.name}`
                          : "新对话"}
                </p>
                <h1 id="run-title">
                  {mainTab === "projects"
                    ? "人和 Agent 共用一份上下文"
                    : mainTab === "experts"
                      ? "换角色干活"
                      : mainTab === "skills"
                      ? "给 Agent 装工作手册"
                      : mainTab === "memories"
                      ? "跨对话记住的事"
                      : mainTab === "automations"
                      ? "到点自动开对话"
                      : currentRun
                        ? preview(currentRun.prompt)
                        : expertPick.expertTeamId || expertPick.expertId
                          ? `以「${
                              teams.find((item) => item.id === expertPick.expertTeamId)?.name ||
                              experts.find((item) => item.id === expertPick.expertId)?.name ||
                              "专家"
                            }」开对话`
                          : activeProject
                          ? `在「${activeProject.name}」里开对话`
                          : "和云端 Agent 说话"}
                </h1>
              </div>
            </div>
            <div className="top-actions">
              <InboxBell
                token={token}
                authed={Boolean(userEmail)}
                onOpenRun={(id) => {
                  setMainTab("chat");
                  void openRun(id);
                }}
                onOpenProject={(id) => openProjects(id)}
              />
              {narrow ? (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="记忆"
                  title="记忆"
                  onClick={openMemories}
                >
                  <IconMemory size={16} />
                </button>
              ) : null}
              {narrow ? <TranscriptSearch messages={displayMessages} onJump={setHighlightId} /> : null}
              {isDeskApp() ? (
                <span className="desk-badge" title="Desk 预览，本机执行可用">
                  Desk
                </span>
              ) : null}
              {narrow && mainTab === "chat" && (busy || currentRun) ? (
                <span id="status" className={busy ? "buddy-status-pill is-busy" : "buddy-status-pill"} data-state={statusView.state} data-busy={busy ? "true" : "false"}>
                  {busy ? "跑着" : statusView.label}
                </span>
              ) : (
                <span className="status" id="status" data-state={statusView.state} data-busy={busy ? "true" : "false"}>
                  {busy ? <span className="pulse-dot" aria-hidden="true" /> : null}
                  {statusView.label}
                </span>
              )}
              <details className="top-more" ref={topMoreRef}>
                <summary className="icon-btn top-more-sum" aria-label="更多">
                  <IconMore />
                </summary>
                <div
                  className="top-more-menu"
                  onClick={(event) => {
                    if (!narrow) return;
                    const action = (event.target as HTMLElement | null)?.closest("button, a");
                    const details = event.currentTarget.closest("details");
                    if (action && details) details.removeAttribute("open");
                  }}
                >
              <span className="vm-badge" id="vm-badge" data-busy={currentSlot ? "true" : "false"}>
                {currentSlot ? `${slotLabel(currentSlot)} · ${currentSlot}` : runId ? "分配 VM 中…" : "未分配 VM"}
              </span>
              {formatUsage(currentRun?.usage) ? (
                <span className="vm-badge" id="usage-badge">
                  {formatUsage(currentRun?.usage)}
                </span>
              ) : null}
              <nav className="session-tabs" hidden={!runId} aria-label="会话标签">
                {(
                  [
                    ["chat", "对话", IconChat],
                    ["files", "工作区", IconFiles],
                    ["diff", "Diff", IconDiff],
                    ["terminal", "终端", IconTerminal],
                    ["artifacts", "产物", IconArtifacts],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <Tooltip key={id} content={label} side="bottom">
                    <button
                      type="button"
                      className={sessionTab === id ? "active" : ""}
                      aria-label={label}
                      aria-current={sessionTab === id ? "page" : undefined}
                      onClick={() => openInspector(id)}
                    >
                      <Icon size={14} />
                      <span className="tab-label">{label}</span>
                    </button>
                  </Tooltip>
                ))}
              </nav>
              {runId && currentRun?.executionTarget?.loop !== "desk" && deskBridge()?.canRunLocal ? (
                <button
                  className="icon-btn"
                  type="button"
                  title="未提交的改动不会带过去，先 commit 或 stash"
                  onClick={() => void handoffCurrent("desk")}
                >
                  切到本机
                </button>
              ) : null}
              {handoffError ? <span className="setup err">{handoffError}</span> : null}
              {narrow ? null : <TranscriptSearch messages={displayMessages} onJump={setHighlightId} />}
              <button
                className="icon-btn"
                id="archive-run"
                type="button"
                aria-label="归档"
                hidden={!runId || currentRun?.status === "ARCHIVED"}
                onClick={() => {
                  if (!runId || !window.confirm("归档后会释放 VM。确定？")) return;
                  void (async () => {
                    const archived = await readJson<Run & { error?: string }>(
                      await api(token, `/v1/runs/${runId}/archive`, { method: "POST" }),
                    );
                    if (archived.error) throw new Error(archived.error);
                    setCurrentRun(archived);
                    setRuns((prev) => prev.map((item) => (item.id === archived.id ? { ...item, ...archived } : item)));
                  })().catch((error) => {
                    setMessages((prev) => [...prev, localErrorMessage(runId, error instanceof Error ? error.message : "归档失败")]);
                  });
                }}
              >
                <IconArchive size={16} />
                <span className="tab-label">归档</span>
              </button>
              <button
                className="icon-btn"
                id="delete-run"
                type="button"
                aria-label="删除"
                hidden={!runId || currentRun?.status !== "ARCHIVED"}
                onClick={() => {
                  if (!runId) return;
                  void deleteArchivedRun(runId).catch((error) => {
                    setMessages((prev) => [...prev, localErrorMessage(runId, error instanceof Error ? error.message : "删除失败")]);
                  });
                }}
              >
                <IconTrash size={16} />
                <span className="tab-label">删除</span>
              </button>
              <button
                className="icon-btn"
                id="toggle-settings"
                type="button"
                aria-label={settingsOpen ? "收起设置" : "设置"}
                aria-expanded={settingsOpen}
                onClick={() => {
                  const next = !settingsOpen;
                  setSettingsOpen(next);
                  if (next) {
                  }
                }}
              >
                <IconGear size={16} />
                <span className="tab-label">{settingsOpen ? "收起设置" : "设置"}</span>
              </button>
              {pr?.url ? (
                <a className="pr-link" id="pr-link" href={pr.url} target="_blank" rel="noreferrer">
                  <IconPr size={14} />
                  {pr.draft === false ? "PR" : "草稿 PR"}
                </a>
              ) : null}
              <button
                className="icon-btn"
                id="open-pr"
                type="button"
                aria-label="开草稿 PR"
                hidden={Boolean(pr?.url) || !runId}
                onClick={() => void openDraftPr()}
              >
                <IconPr size={14} />
                <span className="tab-label">开草稿 PR</span>
              </button>
                </div>
              </details>
            </div>
          </header>
          <div className={inspectorOpen ? "workspace-col has-inspector" : "workspace-col"}>
          <div className="workspace-stage">
          {settingsOpen ? (
            <aside className="workspace-drawer" id="workspace-drawer" role="dialog" aria-label="设置">
              <div className="workspace-drawer-bar">
                <strong>设置</strong>
                <button
                  type="button"
                  className="ghost"
                  id="close-drawer"
                  onClick={() => {
                    setSettingsOpen(false);
                  }}
                >
                  关闭
                </button>
              </div>
              <VmSlots
                slots={vms.slots}
                backend={vms.backend}
                currentRunId={runId}
                runs={runs}
                onOpenRun={(id) => {
                  setSettingsOpen(false);
                  setMainTab("chat");
                  void openRun(id);
                }}
              />
                <SettingsPanel
                  repo={repo}
                  envId={envId}
                  buildId={buildId}
                  environments={environments}
                  builds={builds}
                  llm={llm}
                  llmKey={llmKey}
                  scm={scm}
                  scmToken={scmToken}
                  onRepo={setRepo}
                  onEnv={setEnvId}
                  onBuild={setBuildId}
                  onLlmUpstream={(value) =>
                    setLlm((prev) => ({
                      ...prev,
                      upstream: value,
                      model: resolveChatModel(value, prev.model),
                    }))
                  }
                  onLlmModel={(value) => setLlm((prev) => ({ ...prev, model: value }))}
                  onLlmKey={setLlmKey}
                  onSaveLlm={() => {
              void (async () => {
                if (!llmKey && !llm.configured && !(llm.newApi?.consoleUrl || llm.newApi?.url)) return;
                const payload: Record<string, string> = {
                  upstream: llm.upstream || "deepseek",
                  model: resolveChatModel(llm.upstream, llm.model),
                };
                if (llmKey) payload.apiKey = llmKey;
                const saved = await readJson<LlmSettings & { error?: string }>(
                  await api(token, "/v1/settings/llm", { method: "POST", body: JSON.stringify(payload) }),
                );
                if (saved.error === "login_required") throw new Error("请先登录再保存 API Key");
                if (saved.error) throw new Error(saved.error);
                setLlm({
                  configured: saved.configured,
                  upstream: saved.upstream,
                  model: saved.model,
                  newApi: saved.newApi ?? llm.newApi,
                });
                setLlmKey("");
                const nextHealth = await readJson<Health>(await fetch("/health"));
                setHealth(nextHealth);
                setHealthText(formatHealth(nextHealth, vms));
              })().catch((error) => {
                setLlm((prev) => ({ ...prev, model: error instanceof Error ? error.message : "保存失败" }));
              });
            }}
                  onScmToken={setScmToken}
                  onSaveScm={() => {
              void (async () => {
                if (!scmToken && !scm.configured) return;
                const payload: { token?: string } = {};
                if (scmToken) payload.token = scmToken;
                const saved = await readJson<ScmSettings & { error?: string }>(
                  await api(token, "/v1/settings/scm", { method: "POST", body: JSON.stringify(payload) }),
                );
                if (saved.error === "login_required") throw new Error("请先登录再保存 GitHub 凭证");
                if (saved.error) throw new Error(saved.error);
                setScm({
                  configured: saved.configured,
                  method: saved.method === "github-app" || saved.method === "pat" ? saved.method : "none",
                });
                setScmToken("");
                const nextHealth = await readJson<Health>(await fetch("/health"));
                setHealth(nextHealth);
                setHealthText(formatHealth(nextHealth, vms));
              })().catch((error) => {
                setScm((prev) => ({ ...prev, method: "none" }));
                setHealthText(error instanceof Error ? error.message : "保存 GitHub 凭证失败");
              });
            }}
                  onClearScm={() => {
              void (async () => {
                const saved = await readJson<ScmSettings & { error?: string }>(
                  await api(token, "/v1/settings/scm", { method: "POST", body: JSON.stringify({ clear: true }) }),
                );
                if (saved.error) throw new Error(saved.error);
                setScm({ configured: false, method: "none" });
                setScmToken("");
                const nextHealth = await readJson<Health>(await fetch("/health"));
                setHealth(nextHealth);
                setHealthText(formatHealth(nextHealth, vms));
              })().catch((error) => {
                setHealthText(error instanceof Error ? error.message : "清除 GitHub 凭证失败");
              });
            }}
                  token={token}
                  onWarm={() => {
                    void (async () => {
                      if (!repo.trim()) {
                        setMessages((prev) => [...prev, localErrorMessage(runId, "预热前先填仓库。")]);
                        return;
                      }
                      const created = await readJson<{ id?: string; status?: string; error?: string; failureMessage?: string }>(
                        await api(token, "/v1/builds", {
                          method: "POST",
                          body: JSON.stringify({ repoUrls: [repo.trim()], envId: envId || undefined }),
                        }),
                      );
                      if (created.error) throw new Error(created.error);
                      await refreshEnvironments();
                      if (created.id && created.status === "SUCCEEDED") setBuildId(created.id);
                    })().catch((error) => {
                      setMessages((prev) => [...prev, localErrorMessage(runId, error instanceof Error ? error.message : "预热失败")]);
                    });
                  }}
                />
            </aside>
          ) : null}
            {mainTab === "projects" ? (
              <ProjectsPage
                token={token}
                userId={userId}
                inviteToken={inviteToken}
                selectedId={selectedProjectId}
                onOpenProject={(id) => openProjects(id)}
                onStartChat={startProjectChat}
                onOpenRun={(id) => {
                  setMainTab("chat");
                  void openRun(id);
                }}
              />
            ) : mainTab === "experts" ? (
              <ExpertsPage
                token={token}
                userId={userId}
                selectedId={selectedExpertId}
                projectId={activeProject?.id}
                onOpenExpert={(id) => openExperts(id)}
                onSummon={(pick) => {
                  resetComposer();
                  setExpertPick({ expertId: pick.expertId, expertTeamId: pick.expertTeamId });
                  setMainTab("chat");
                }}
              />
            ) : mainTab === "skills" ? (
              <SkillsPage
                token={token}
                selectedId={selectedSkillId}
                projectId={activeProject?.id}
                onOpenPlugin={(id) => openSkills(id)}
                onUse={(plugin) => void useSkill(plugin)}
              />
            ) : mainTab === "memories" ? (
              <MemoriesPage token={token} onBack={openChat} />
            ) : mainTab === "automations" ? (
              <AutomationsPage
                token={token}
                onOpenRun={(id) => {
                  setMainTab("chat");
                  void openRun(id);
                }}
              />
            ) : (
              <ChatErrorBoundary onReset={() => (runId ? void openRun(runId) : resetComposer())}>
                {shouldShowBuddyHome({
                  narrow,
                  runId,
                  loadingTranscript,
                  pending: Boolean(pendingTurn),
                  messageCount: displayMessages.length,
                }) ? (
                  <BuddyHome
                    moreOpen={moreOpen}
                    target={deskTarget.kind === "desk" ? "desk" : "cloud"}
                    deskDisabled={!deskBridge()?.canRunLocal && !desks.some((desk) => desk.online && desk.allowRemote === true && (desk.workspaces?.length ?? 0) > 0)}
                    skills={buddySkillsFromRecipes(BUNDLED_RECIPES)}
                    onTarget={(value) => applyTarget({ ...deskTarget, kind: value })}
                    onShortcut={(id) => {
                      if (id === "more") setMoreOpen((value) => !value);
                      if (id === "experts") openExperts();
                      if (id === "skills") openSkills();
                      if (id === "projects") openProjects();
                    }}
                    onSkill={(id) => {
                      const recipe = recipeById(id);
                      if (recipe) applyRecipe(recipe);
                    }}
                  />
                ) : (
                  <Transcript
                    messages={displayMessages}
                    remaining={remaining}
                    empty={!loadingTranscript && displayMessages.length === 0}
                    loading={loadingTranscript && displayMessages.length === 0}
                    loadingOlder={loadingOlder}
                    busy={busy}
                    activity={activity}
                    highlightId={highlightId}
                    onLoadOlder={loadOlder}
                    onOpenDiagnostics={openDiagnostics}
                    onPickRecipe={applyRecipe}
                  />
                )}
              </ChatErrorBoundary>
            )}
          </div>
          {inspectorOpen ? (
            <aside className="inspector" id="workspace-inspector" aria-label="工作区">
              <div className="inspector-bar">
                <strong>
                  {sessionTab === "files"
                    ? "工作区"
                    : sessionTab === "diff"
                      ? "Diff"
                      : sessionTab === "terminal"
                        ? "终端"
                        : "产物"}
                </strong>
                <button type="button" className="icon-btn" aria-label="关闭检查器" onClick={() => openInspector("chat")}>
                  <IconClose size={16} />
                </button>
              </div>
              {sessionTab === "files" ? <FileTree token={token} runId={runId} open={Boolean(runId)} /> : null}
              {sessionTab === "diff" ? (
                <DiffPanel
                  open
                  loading={diffLoading}
                  error={diffError}
                  stat={diffStat}
                  patch={diffPatch}
                  committing={committing}
                  commitError={commitError}
                  onCommit={(message) => void commitWorkspace(message)}
                />
              ) : null}
              {sessionTab === "terminal" ? <TerminalPanel open loading={diagLoading} error={diagError} logs={diagLogs} /> : null}
              {sessionTab === "artifacts" ? (
                <ArtifactsPanel
                  open
                  loading={artifactsLoading}
                  error={artifactsError}
                  artifacts={artifacts}
                  projectId={currentRun?.projectId ?? activeProject?.id}
                  token={token}
                  runId={runId}
                  onSaved={() => {
                    const projectId = currentRun?.projectId ?? activeProject?.id;
                    if (!projectId || !token) return;
                    void api(token, `/v1/projects/${encodeURIComponent(projectId)}/assets`).then(async (response) => {
                      if (!response.ok) return;
                      const body = await readJson<{ assets?: ProjectAsset[] }>(response);
                      setProjectAssets(body.assets ?? []);
                    });
                  }}
                  onOpen={
                    deskBridge()?.openPath
                      ? (item) => {
                          if (item.url) void deskBridge()?.openPath?.(item.url);
                        }
                      : undefined
                  }
                />
              ) : null}
            </aside>
          ) : null}
          </div>
          {mainTab === "chat" && (activeProject || expertPick.expertId || expertPick.expertTeamId || pluginPick) ? (
            <div className="proj-chip-bar" id="project-chip">
              {activeProject ? (
                <span className="proj-chip">
                  {runId ? `项目对话 · ${activeProject.name}` : `将在项目「${activeProject.name}」中开对话`}
                </span>
              ) : null}
              {expertPick.expertTeamId || expertPick.expertId ? (
                <span className="proj-chip">
                  {expertPick.expertTeamId
                    ? `专家团 · ${teams.find((item) => item.id === expertPick.expertTeamId)?.name ?? "已选"}`
                    : `专家 · ${experts.find((item) => item.id === expertPick.expertId)?.name ?? "已选"}`}
                </span>
              ) : null}
              {pluginPick ? (
                <span className="proj-chip">技能 · {pluginPickerLabel(pluginPick)}</span>
              ) : null}
              {runId && activeProject ? (
                <button type="button" className="ghost" onClick={() => openProjects(activeProject.id)}>
                  打开项目
                </button>
              ) : !runId && activeProject ? (
                <button type="button" className="ghost" onClick={() => setActiveProject(null)}>
                  不用项目
                </button>
              ) : null}
              {!runId && (expertPick.expertId || expertPick.expertTeamId) ? (
                <button type="button" className="ghost" onClick={() => setExpertPick({})}>
                  不用专家
                </button>
              ) : null}
              {!runId && pluginPick ? (
                <button type="button" className="ghost" onClick={() => setPluginPick(null)}>
                  不用技能
                </button>
              ) : null}
            </div>
          ) : null}
          {mainTab === "chat" ? (
            <Composer
              prompt={prompt}
              images={images}
              vmHint={deskTarget.kind === "desk" ? localTargetHint : vmHint}
              busy={busy}
              stopping={stopping}
              archived={archived}
              canStop={Boolean(runId)}
              activity={activity}
              contextUsage={contextUsage}
              target={deskTarget}
              canRunLocal={Boolean(deskBridge()?.canRunLocal)}
              folder={deskFolder}
              desks={desks}
              targetLocked={currentRun?.executionTarget?.loop === "desk"}
              targetLockLabel={
                currentRun?.executionTarget?.remoteControl === true ? "Remote Control" : "This Computer"
              }
              blocked={hostLock.locked}
              blockedHint={hostLock.hint}
              mode={agentMode}
              model={selectedModel}
              experts={experts}
              teams={teams}
              expertValue={
                runId
                  ? encodeExpertPick({
                      expertId: currentRun?.expertId ?? undefined,
                      expertTeamId: currentRun?.expertTeamId ?? undefined,
                    })
                  : encodeExpertPick(expertPick)
              }
              expertLocked={Boolean(runId)}
              mentions={composerMentions}
              showCapsules={!runId}
              onMention={applyMention}
              onCapsule={applyCapsule}
              onTarget={applyTarget}
              onPickFolder={() => {
                void deskBridge()?.pickFolder().then((folder) => {
                  if (folder) {
                    applyTarget({ ...deskTarget, kind: "desk", folder });
                  }
                });
              }}
              onMode={setAgentMode}
              onExpert={(value) => setExpertPick(decodeExpertPick(value))}
              onModel={(value) =>
                setLlm((prev) => ({
                  ...prev,
                  model: value,
                  upstream: /gpt/i.test(value) ? "openai" : "deepseek",
                }))
              }
              onPrompt={setPrompt}
              onImages={setImages}
              onSend={() => void sendMessage()}
              onQueue={() => void queueMessage()}
              onStop={stopTurn}
              layout={narrow ? "buddy" : "default"}
              followUp={Boolean(runId)}
              onOpenPlus={() => setPlusOpen(true)}
            />
          ) : null}
          {narrow && mainTab === "chat" ? <p className="buddy-footer">内容由 AI 生成 · DeepSeek</p> : null}
        </main>
      </div>
      <input
        ref={imagePickRef}
        type="file"
        accept="image/*"
        hidden
        multiple
        onChange={(event) => {
          addPickedImages(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={cameraPickRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          addPickedImages(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <BuddyPlusSheet open={plusOpen} canOpenPr={Boolean(runId) && !pr?.url} onClose={() => setPlusOpen(false)} onAction={applyBuddyPlus} />
      <AuthGate
        open={authOpen}
        mode={authMode}
        busy={authBusy}
        error={authError}
        email={authEmail}
        username={authUsername}
        phone={authPhone}
        password={authPassword}
        token={authToken}
        onMode={setAuthMode}
        onEmail={setAuthEmail}
        onUsername={setAuthUsername}
        onPhone={setAuthPhone}
        onPassword={setAuthPassword}
        onToken={setAuthToken}
        onSubmit={() => {
          if (authBusy) return;
          if (authMode === "token") {
            if (!authToken.trim()) {
              setAuthError("请输入服务令牌");
              return;
            }
          } else if (authMode === "register") {
            if (!authUsername.trim() || !authPhone.trim() || !authPassword) {
              setAuthError("请填写用户名、手机号和密码");
              return;
            }
          } else if (!authEmail.trim() || !authPassword) {
            setAuthError("请输入用户名或手机号，以及密码");
            return;
          }
          setAuthBusy(true);
          void (async () => {
            if (authMode === "token") {
              persistToken(authToken.trim());
              const response = await fetch(withApiBase("/v1/auth"), {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ token: authToken.trim() }),
              });
              if (!response.ok) {
                persistToken("");
                throw new Error("unauthorized");
              }
              setUserEmail("");
              setAuthOpen(false);
            } else if (authMode === "register") {
              const response = await fetch(withApiBase("/v1/auth/register"), {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  username: authUsername.trim(),
                  phone: authPhone.trim(),
                  password: authPassword,
                }),
              });
              const body = await readJson<{ token?: string; user?: { email?: string }; error?: string; pending?: boolean; message?: string }>(
                response,
              );
              if (!response.ok) throw new Error(body.error || "注册失败");
              if (body.pending || !body.token) {
                setAuthMode("login");
                setAuthEmail(authUsername.trim());
                setAuthPassword("");
                setAuthError(body.message || "注册成功，请等待管理员审核后再登录");
                return;
              }
              await applySession(body.token ?? "", body.user);
            } else {
              const email = authEmail.trim();
              const password = authPassword;
              const response = await fetch(withApiBase("/v1/auth/login"), {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email, password }),
              });
              const body = await readJson<{ token?: string; user?: { email?: string }; error?: string }>(response);
              if (!response.ok) throw new Error(body.error || "unauthorized");
              await applySession(body.token ?? "", body.user);
            }
            void finishLogin();
          })()
            .catch((error) => {
              persistToken("");
              setAuthError(error instanceof Error ? error.message : authMode === "register" ? "注册失败" : "登录失败");
              setAuthOpen(true);
            })
            .finally(() => setAuthBusy(false));
        }}
      />
    </>
  );
}

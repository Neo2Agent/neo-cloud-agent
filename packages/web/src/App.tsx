import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyRunEventsToMessages,
  DEFAULT_TRANSCRIPT_PAGE,
  displayTranscriptMessages,
  settleTranscriptMessages,
  transcriptBodyNeeded,
} from "@neo-cloud-agent/contracts/transcript";
import { CHAT_MODELS, resolveCatalogSelection } from "@neo-cloud-agent/contracts/llm-ids";
import type { RunEvent, TranscriptMessage, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import { decodeExpertPick, encodeExpertPick, expertPickerLabel, type Expert, type ExpertPick, type ExpertTeam } from "@neo-cloud-agent/contracts/expert";
import { isRemoteControlTarget, type ImageRef, type PullRequestRef, type Run } from "@neo-cloud-agent/contracts/run";
import { runGitContext } from "@neo-cloud-agent/contracts/git";
import { isDeskHostedTarget, type Desk, type DeskWorkspace } from "@neo-cloud-agent/contracts/desk";
import { api, hydrateDeskToken, readJson, readToken, writeToken } from "./api";
import { hasSavedSession } from "./session";
import { deskBridge, isDeskApp, withApiBase, type DeskTarget } from "./desk";
import { remoteControlSendLock } from "./desk-live";
import { readPinnedRuns, togglePinnedRun } from "./pins";
import { readLastRunId, readLastTarget, readRecentRepos, rememberRecentRepo, resolveStartupRunId, writeLastRunId, writeLastTarget } from "./prefs";
import { cloudSafeRepoUrls, isLocalFolderRef, normalizeRepoUrl } from "./repo";
import { shortcutAction } from "./shortcuts";
import {
  applyLiveEvents,
  parseSseData,
  parseUserListEvent,
  runListEventsQuery,
  RUN_LIST_REFRESH_MS,
  RUN_LIST_STREAM_PATH,
} from "@neo-cloud-agent/contracts/client-stream";
import { AuthGate, type AuthMode } from "./components/AuthGate";
import { ChatErrorBoundary } from "./components/ChatErrorBoundary";
import { ArtifactsPanel } from "./components/ArtifactsPanel";
import { GitPanel } from "./components/GitPanel";
import { FileTree } from "./components/FileTree";
import { InspectorShell, type InspectorTab } from "./components/Inspector";
import { WorkspaceFiles, type FilesView } from "./components/WorkspaceFiles";
import { TerminalPanel } from "./components/TerminalPanel";
import { AutomationsPage } from "./components/AutomationsPage";
import { ExpertsPage } from "./components/ExpertsPage";
import { SkillsPage } from "./components/SkillsPage";
import { ProjectsPage } from "./components/ProjectsPage";
import { MemoriesPage } from "./components/MemoriesPage";
import { SettingsPanel, type BuildOption, type EnvOption, type LlmSettings, type ScmSettings } from "./components/SettingsPanel";
import type { GithubRepoOption, RepoBindMode } from "./components/RepoBindControl";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { ProjectAsset } from "@neo-cloud-agent/contracts/project-asset";
import { BUNDLED_RECIPES, recipeById, type IntentCapsule, type Recipe } from "@neo-cloud-agent/contracts/recipe";
import { pluginPickerLabel, type PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import { parseProjectHash, projectHashHref } from "./project-route.js";
import { InboxBell } from "./components/InboxBell";
import { RunInvite } from "./components/RunInvite";
import { BuddyHome, BuddyPlusSheet, buddySkillsFromRecipes, type BuddyPlusAction } from "@neo-cloud-agent/ui";
import { Composer, readImageRef } from "./components/Composer";
import { useConfirm, toast } from "./feedback";
import {
  IconArchive,
  IconBack,
  IconComputer,
  IconGear,
  IconInfo,
  IconMemory,
  IconPanelRight,
  IconPr,
  IconSidebarOpen,
  IconTrash,
} from "./icons";
import { Sidebar, type VmSlotView } from "./components/Sidebar";
import { ContextUsagePanel } from "./components/ContextUsage";
import { SessionSearch } from "./components/SessionSearch";
import { Transcript } from "./components/Transcript";
import { TranscriptSearch } from "./components/TranscriptSearch";
import type { ComposerMention } from "./mention";
import {
  baselineContextUsage,
  overlayContextUsage,
  parseContextUsage,
  resolveModelLimits,
} from "@neo-cloud-agent/contracts/context-usage";
import {
  formatRunTime,
  formatUsage,
  modelLabel,
  nextChatModel,
  preview,
  resolveChatModel,
  runListTitle,
  shortId,
  slotLabel,
  slotMenuLines,
  upstreamForChatModel,
} from "./format";
import {
  isActiveRunStatus,
  isComposerClosed,
  isTerminalTurnEvent,
  isTurnBusy,
  pendingUserArrived,
  runningToolName,
  shouldRefreshTranscript,
  statusFromEventKind,
  withPendingUser,
  withQueuedNotice,
  type PendingUser,
} from "@neo-cloud-agent/contracts/turn-state";
import { activityLabel, isAssistantStreaming, shouldShowBuddyHome, turnStatusLabel } from "./turn";
import { NARROW_MQ, closeMobileSidebar, isNarrowViewport } from "./viewport";
import { clampPane, paneCeiling, paneDefault, paneSnapPhase, SIDEBAR_DEFAULT, type PaneSnap } from "./pane-size";

const HISTORY_PAGE = DEFAULT_TRANSCRIPT_PAGE;


function transcriptUrl(id: string, extra?: { before?: string }): string {
  const params = new URLSearchParams({ limit: String(HISTORY_PAGE), images: "href" });
  if (extra?.before) {
    params.set("before", extra.before);
  }
  return `/v1/runs/${id}/transcript?${params}`;
}

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
  neoLoop?: { available?: boolean };
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
  return parseProjectHash(location.hash).projectId;
}

function hashProjectAssets(): boolean {
  return parseProjectHash(location.hash).assets;
}

function hashProjectAssetId(): string | null {
  return parseProjectHash(location.hash).assetId;
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

function hashSettings(): boolean {
  return location.hash === "#/settings" || location.hash.startsWith("#/settings?");
}

function hashCatalog(): boolean {
  return hashAutomations() || hashProjects() || hashExperts() || hashSkills() || hashMemories() || hashSettings();
}

function initialMainTab(): "chat" | "automations" | "projects" | "experts" | "skills" | "memories" | "settings" {
  if (hashAutomations()) return "automations";
  if (hashProjects()) return "projects";
  if (hashExperts()) return "experts";
  if (hashSkills()) return "skills";
  if (hashMemories()) return "memories";
  if (hashSettings()) return "settings";
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

function readRailWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT;
  if (window.innerWidth < 860) return 0;
  return window.localStorage.getItem("neo.sidebar") === "0" ? 48 : SIDEBAR_DEFAULT;
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
  const [userName, setUserName] = useState("");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [paneWidth, setPaneWidth] = useState(() => paneDefault(typeof window === "undefined" ? 1440 : window.innerWidth, readRailWidth()));
  const [paneMaxWidth, setPaneMaxWidth] = useState(() =>
    paneCeiling(typeof window === "undefined" ? 1440 : window.innerWidth, readRailWidth()),
  );
  const [paneFull, setPaneFull] = useState(false);
  const [paneSnap, setPaneSnap] = useState<PaneSnap>("idle");
  const [filesView, setFilesView] = useState<FilesView>("tree");
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
  const [repo, setRepo] = useState("");
  const [repoMode, setRepoMode] = useState<RepoBindMode>("none");
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [recentRepos, setRecentRepos] = useState<string[]>(() => (typeof window === "undefined" ? [] : readRecentRepos()));
  const [envId, setEnvId] = useState("");
  const [buildId, setBuildId] = useState("");
  const [environments, setEnvironments] = useState<EnvOption[]>([]);
  const [builds, setBuilds] = useState<BuildOption[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab | null>(null);
  const [lastPane, setLastPane] = useState<InspectorTab>("terminal");
  const [artifactFocus, setArtifactFocus] = useState<string | null>(null);
  const [contextFocusId, setContextFocusId] = useState("");
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
  const [handoffError, setHandoffError] = useState("");
  const [mainTab, setMainTab] = useState<
    "chat" | "automations" | "projects" | "experts" | "skills" | "memories" | "settings" | "context"
  >(initialMainTab);
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
  const [projectAssetsTab, setProjectAssetsTab] = useState(hashProjectAssets);
  const [highlightAssetId, setHighlightAssetId] = useState<string | null>(hashProjectAssetId);
  const [inviteToken, setInviteToken] = useState<string | null>(hashInviteToken);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [llm, setLlm] = useState<LlmSettings>({ configured: false, upstream: "deepseek", model: null });
  const [llmKey, setLlmKey] = useState("");
  const [githubRepos, setGithubRepos] = useState<GithubRepoOption[]>([]);
  const [githubReposConfigured, setGithubReposConfigured] = useState(false);
  const [githubReposLoading, setGithubReposLoading] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<PendingUser | null>(null);
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const [sidebarMotion, setSidebarMotion] = useState(false);
  const [sidebarShown, setSidebarShown] = useState(false);
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
  const runsRefreshedRef = useRef(0);
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
  const confirm = useConfirm();

  const selectedModel = resolveCatalogSelection(
    currentRun?.model || llm.model,
    llm.models?.length ? llm.models : CHAT_MODELS,
  );
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
            const incoming = {
              url: String(event.data.url),
              draft: event.data.draft !== false,
              repoUrl: "",
              branch: "",
              number: typeof event.data.number === "number" ? event.data.number : null,
              title: typeof event.data.title === "string" ? event.data.title : "",
            };
            patchRun(id, (run) => {
              const match = (item: { url?: string; number?: number | null }) =>
                item.url === incoming.url || (incoming.number != null && item.number === incoming.number);
              const list = run.pullRequests ?? [];
              return {
                ...run,
                pullRequests: list.some(match)
                  ? list.map((item) => (match(item) ? { ...item, ...incoming } : item))
                  : [...list, incoming],
              };
            });
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
          models: settings.models,
          modelsSource: settings.modelsSource,
        });
        setLlmKey("");
      }
    } catch {
      // optional
    }
  }, []);

  const refreshGithubRepos = useCallback(async (q = "") => {
    if (!tokenRef.current) return;
    setGithubReposLoading(true);
    try {
      const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const response = await api(tokenRef.current, `/v1/scm/repos${query}`);
      if (!response.ok) return;
      const body = await readJson<{
        configured?: boolean;
        connected?: boolean;
        repos?: GithubRepoOption[];
        error?: string;
      }>(response);
      if (body.error) return;
      setGithubReposConfigured(Boolean(body.configured ?? body.connected));
      setGithubRepos(body.repos ?? []);
    } catch {
      // optional
    } finally {
      setGithubReposLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!repoPickerOpen) return;
    const timer = window.setTimeout(() => {
      void refreshGithubRepos(repoQuery);
    }, repoQuery.trim() ? 200 : 0);
    return () => window.clearTimeout(timer);
  }, [refreshGithubRepos, repoPickerOpen, repoQuery]);

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
    setInspectorTab(null);
    setSending(false);
    setStopping(false);
    setPendingTurn(null);
    setEnvId("");
    setBuildId("");
    setRepo("");
    setRepoMode("none");
    setRepoPickerOpen(false);
    setRepoQuery("");
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
      setInspectorTab(null);
      setHighlightId(null);
      history.replaceState(null, "", `/#/runs/${id}`);
      const [runRes, transcriptRes] = await Promise.all([
        api(tokenRef.current, `/v1/runs/${id}`),
        api(tokenRef.current, transcriptUrl(id)),
      ]);
      if (openGenRef.current !== gen) return false;
      if (!runRes.ok) {
        setLoadingTranscript(false);
        if (runRes.status === 404) {
          setRunId(null);
          setCurrentRun(null);
          history.replaceState(null, "", "/");
          toast("打不开这条对话：它已删除、不是你的，或是另一台电脑上的本机对话。", "err");
        }
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
      const visibleRepo = !isDeskApp() && isLocalFolderRef(firstRepo) ? "" : firstRepo;
      setRepo(visibleRepo);
      setRepoMode(visibleRepo ? "bind" : "none");
      setRepoPickerOpen(false);
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
      if (isDeskHostedTarget(run.executionTarget)) {
        void refreshDesks();
      }
      return true;
    },
    [listen, refreshDesks, refreshVms],
  );

  const openAutomations = useCallback(() => {
    setMainTab("automations");
    history.replaceState(null, "", "/#/automations");
  }, []);

  const openExperts = useCallback((id?: string | null) => {
    setMainTab("experts");
    setSelectedExpertId(id ?? null);
    history.replaceState(null, "", id ? `/#/experts/${id}` : "/#/experts");
  }, []);

  const openSkills = useCallback((id?: string | null) => {
    setMainTab("skills");
    setSelectedSkillId(id ?? null);
    history.replaceState(null, "", id ? `/#/skills/${id}` : "/#/skills");
  }, []);

  const openMemories = useCallback(() => {
    setMainTab("memories");
    history.replaceState(null, "", "/#/memories");
  }, []);

  const openSettings = useCallback(() => {
    setMainTab("settings");
    history.replaceState(null, "", "/#/settings");
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

  const openProjects = useCallback(
    (id?: string | null, opts?: { invite?: string | null; assets?: boolean; assetId?: string | null }) => {
      const invite = opts?.invite ?? null;
      const assetId = opts?.assetId ?? null;
      const assets = Boolean(opts?.assets || assetId);
      setMainTab("projects");
      setSelectedProjectId(id ?? null);
      setInviteToken(invite);
      setProjectAssetsTab(assets);
      setHighlightAssetId(assetId);
      if (invite) {
        history.replaceState(null, "", `/#/invite/${invite}`);
        return;
      }
      history.replaceState(null, "", projectHashHref(id, { assets, assetId }));
    },
    [],
  );

  const startProjectChat = useCallback(
    (project: { id: string; name: string }) => {
      resetComposer();
      setActiveProject({ id: project.id, name: project.name });
      setDeskTarget({ kind: "cloud" });
      writeLastTarget({ kind: "cloud" });
      void deskBridge()?.setTarget({ kind: "cloud" });
      setMainTab("chat");
    },
    [resetComposer],
  );

  const startRepoChat = useCallback(
    (repoUrl?: string) => {
      resetComposer();
      setActiveProject(null);
      setDeskTarget({ kind: "cloud" });
      writeLastTarget({ kind: "cloud" });
      void deskBridge()?.setTarget({ kind: "cloud" });
      if (repoUrl) {
        setRepo(repoUrl);
        setRepoMode("bind");
        setRepoPickerOpen(false);
      } else {
        setRepo("");
        setRepoMode("bind");
        setRepoPickerOpen(true);
      }
      setMainTab("chat");
    },
    [resetComposer],
  );

  const openChat = useCallback(() => {
    setMainTab("chat");
    setInspectorTab(null);
    if (hashCatalog()) {
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
    if (hashSettings()) {
      setMainTab("settings");
      await Promise.all(refreshShell);
      return;
    }
    const invite = hashInviteToken();
    const projectId = hashProjectId();
    if (invite || projectId || location.hash === "#/projects") {
      setMainTab("projects");
      setInviteToken(invite);
      setSelectedProjectId(projectId);
      setProjectAssetsTab(hashProjectAssets());
      setHighlightAssetId(hashProjectAssetId());
      await Promise.all(refreshShell);
      return;
    }
    const match = resolveStartupRunId({
      hashRunId: hashRunId(),
      lastRunId: readLastRunId(),
      narrow: isNarrowViewport(),
    });
    await Promise.all([
      refreshRuns(),
      match ? openRun(match) : Promise.resolve(),
      refreshEnvironments(),
      refreshLlm(),
      refreshVms(),
      refreshDesks(),
    ]);
    if (!match && !hashRunId() && !hashCatalog()) resetComposer();
  }, [openRun, refreshDesks, refreshEnvironments, refreshExperts, refreshLlm, refreshRuns, refreshVms, resetComposer]);

  const applySession = useCallback(
    async (nextToken: string, user?: { id?: string; email?: string; username?: string; avatar?: string | null } | null) => {
      if (!nextToken) throw new Error("登录响应缺少会话");
      persistToken(nextToken);
      const applyUser = (next: { id?: string; email?: string; username?: string; avatar?: string | null }) => {
        setUserEmail(next.email ?? "");
        setUserId(next.id ?? "");
        setUserName(next.username || next.email || "");
        setUserAvatar(next.avatar ?? null);
      };
      if (user?.email) applyUser(user);
      const me = await api(nextToken, "/v1/me");
      if (!me.ok) {
        if (user?.email) {
          setAuthOpen(false);
          setAuthError("");
          setAuthPassword("");
          return;
        }
        persistToken("");
        setUserEmail("");
        setUserId("");
        setUserName("");
        setUserAvatar(null);
        throw new Error("unauthorized");
      }
      const body = await readJson<{ user?: { id?: string; email?: string; username?: string; avatar?: string | null } }>(me);
      if (!body.user) {
        if (!user?.email) {
          persistToken("");
          setUserEmail("");
          setUserId("");
          setUserName("");
          setUserAvatar(null);
          throw new Error("登录未生效，请再试一次");
        }
      } else {
        applyUser(body.user);
      }
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
    if (!runId && repoMode === "bind") {
      const bound = cloudSafeRepoUrls([normalizeRepoUrl(repo)]);
      if (bound.length === 0) {
        toast("先选出仓库。", "err");
        return;
      }
    }
    const projectCloud = Boolean(activeProject && !runId);
    const effectiveTarget = projectCloud ? { kind: "cloud" as const } : deskTarget;
    // A browser cannot pick a folder, so 本机 needs a machine chosen first.
    if (!runId && effectiveTarget.kind === "desk" && !deskBridge()?.canRunLocal && !deskTarget.deskId) {
      setMessages((prev) => [
        ...prev,
        localErrorMessage(runId, "先选一台电脑。要出现在这里，那台电脑得打开 Desk 并在设置里开启 Remote control。"),
      ]);
      return;
    }
    setRepoPickerOpen(false);
    const attached = images;
    const previousStatus = currentRun?.status;
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
    const skipRepoDefaults = !runId && repoMode === "none";
    const repoUrls =
      skipRepoDefaults
        ? []
        : effectiveTarget.kind === "desk"
          ? (repo.trim() ? [repo.trim()] : deskFolder ? [deskFolder] : [])
          : cloudSafeRepoUrls(repo.trim() ? [normalizeRepoUrl(repo)] : []);
    const model = resolveChatModel(llm.upstream, llm.model, attached.length > 0);
    const buildPayload = buildId === "cold" ? { reuseBuild: false } : buildId ? { buildId, reuseBuild: true } : { reuseBuild: true };
    try {
      if (!runId) {
        const created = await readJson<Run & { error?: string }>(
          await api(tokenRef.current, "/v1/runs", {
            method: "POST",
            body: JSON.stringify({
              prompt: text || "（图片）",
              repoUrls,
              skipRepoDefaults,
              source: effectiveTarget.kind === "desk" ? "desk" : "web",
              envId: envId || undefined,
              model,
              images: attached.length ? attached : undefined,
              projectId: activeProject?.id,
              expertId: expertPick.expertId,
              expertTeamId: expertPick.expertTeamId,
              pluginIds: pluginPick ? [pluginPick.id] : undefined,
              deskWorkspaceId: effectiveTarget.kind === "desk" ? deskTarget.workspaceId : undefined,
              target:
                effectiveTarget.kind === "desk"
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
        if (repoUrls[0] && !isLocalFolderRef(repoUrls[0])) {
          setRecentRepos(rememberRecentRepo(repoUrls[0]));
        }
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
            text: text || "（图片）",
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
  }, [activeProject?.id, buildId, currentRun, desks, deskFolder, deskTarget, envId, expertPick.expertId, expertPick.expertTeamId, images, llm.model, llm.upstream, openRun, patchRun, pluginPick, prompt, repo, repoMode, runId, messages, stopping]);

  const followUpWhileBusy = useCallback(async (delivery: "follow_up" | "steer") => {
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
    setPrompt("");
    setImages([]);
    try {
      const follow = await readJson<{ error?: string }>(
        await api(tokenRef.current, `/v1/runs/${runId}/follow-ups`, {
          method: "POST",
          body: JSON.stringify({
            text: text || "（图片）",
            images: attached.length ? attached : undefined,
            delivery,
          }),
        }),
      );
      if (follow.error) throw new Error(follow.error);
    } catch (error) {
      setPrompt(text);
      setImages(attached);
      const fallback = delivery === "steer" ? "插话失败" : "排队失败";
      setMessages((prev) => [...prev, localErrorMessage(runId, error instanceof Error ? error.message : fallback)]);
    }
  }, [currentRun, desks, deskTarget.deskId, images, prompt, runId]);

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

  const applyPullRequests = useCallback(
    (next: PullRequestRef[]) => {
      if (runId) patchRun(runId, (run) => ({ ...run, pullRequests: next }));
      setCurrentRun((run) => (run ? { ...run, pullRequests: next } : run));
    },
    [patchRun, runId],
  );

  /** Cloud → This Computer only. A local conversation stays local; see handoffRun. */
  const handoffCurrent = useCallback(
    async (_kind: "desk") => {
      if (!runId) return;
      if (
        !(await confirm({
          title: "切到本机？",
          message: "未提交的改动不会带过去，先 commit 或 stash。",
          confirmLabel: "切到本机",
        }))
      ) {
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
    [confirm, deskTarget.deskId, runId],
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
        const listDue = document.visibilityState === "visible" && Date.now() - runsRefreshedRef.current >= RUN_LIST_REFRESH_MS;
        if (runId || listDue) {
          runsRefreshedRef.current = Date.now();
          await refreshRuns();
        }
        await refreshVms();
        await refreshDesks();
      })();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [applyVms, refreshDesks, refreshRuns, refreshVms, runId]);

  useEffect(() => {
    if (!token) return;
    const source = new EventSource(withApiBase(`${RUN_LIST_STREAM_PATH}${runListEventsQuery({ accessToken: token })}`));
    source.onmessage = (event) => {
      if (parseUserListEvent(event.data)) {
        runsRefreshedRef.current = Date.now();
        void refreshRuns();
      }
    };
    return () => source.close();
  }, [refreshRuns, token]);

  useEffect(() => {
    const onVisible = () => {
      if (!tokenRef.current || document.visibilityState !== "visible") return;
      runsRefreshedRef.current = Date.now();
      void refreshRuns();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshRuns]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      if (!tokenRef.current) return;
      const status = currentStatusRef.current;
      if (!shouldRefreshTranscript({ lastSseAt: lastSseAtRef.current, status })) return;
      try {
        const runRes = await api(tokenRef.current, `/v1/runs/${runId}`);
        if (cancelled) return;
        const fresh = runRes.ok ? await readJson<Run>(runRes) : null;
        const nextStatus = fresh?.status ?? status;
        if (fresh && fresh.id === runId) {
          setCurrentRun((prev) => (prev && prev.id === fresh.id ? { ...prev, ...fresh } : prev));
          setRuns((prev) => prev.map((item) => (item.id === fresh.id ? { ...item, ...fresh } : item)));
        }
        if (
          fresh &&
          !transcriptBodyNeeded({
            appliedEventId: lastEventIdRef.current,
            runLastEventId: fresh.lastEventId,
          })
        ) {
          setMessages((prev) => withQueuedNotice(prev, nextStatus));
          return;
        }
        const transcriptRes = await api(tokenRef.current, transcriptUrl(runId));
        if (cancelled) return;
        if (!transcriptRes.ok) return;
        const body = await readJson<{ snapshot?: TranscriptSnapshot }>(transcriptRes);
        const snapshot = body.snapshot;
        if (!snapshot) return;
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

  const resetComposerRef = useRef(resetComposer);
  const openRunRef = useRef(openRun);
  const runIdRef = useRef(runId);
  resetComposerRef.current = resetComposer;
  openRunRef.current = openRun;
  runIdRef.current = runId;

  useEffect(() => {
    const syncHash = () => {
      const invite = hashInviteToken();
      const projectId = hashProjectId();
      if (hashAutomations()) {
        setMainTab("automations");
        setInviteToken(null);
        return;
      }
      if (hashExperts()) {
        setMainTab("experts");
        setSelectedExpertId(hashExpertId());
        setInviteToken(null);
        return;
      }
      if (hashSkills()) {
        setMainTab("skills");
        setSelectedSkillId(hashSkillId());
        setInviteToken(null);
        return;
      }
      if (hashMemories()) {
        setMainTab("memories");
        setInviteToken(null);
        return;
      }
      if (hashSettings()) {
        setMainTab("settings");
        setInviteToken(null);
        return;
      }
      if (invite || projectId || location.hash === "#/projects") {
        setMainTab("projects");
        setInviteToken(invite);
        setSelectedProjectId(projectId);
        setProjectAssetsTab(hashProjectAssets());
        setHighlightAssetId(hashProjectAssetId());
        return;
      }
      setMainTab("chat");
      setInviteToken(null);
      const id = hashRunId();
      if (id) {
        if (runIdRef.current !== id) void openRunRef.current(id);
        return;
      }
      if (isNarrowViewport() && runIdRef.current) resetComposerRef.current();
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
      if (action === "search") {
        event.preventDefault();
        setSearchOpen((open) => !open);
        return;
      }
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
      if (action === "stop") {
        stopTurn();
        return;
      }
      if (action === "cycle-model") {
        setLlm((prev) => {
          const model = nextChatModel(prev.model, prev.models);
          return { ...prev, model, upstream: upstreamForChatModel(model, prev.upstream) };
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
  }, [openRun, resetComposer, runId, runs, stopTurn]);

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

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const el = topMoreRef.current;
      if (!el?.open) return;
      if (!el.contains(event.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, []);

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
  const projectCloudLock = Boolean(activeProject) && !isDeskHostedTarget(currentRun?.executionTarget);
  const hostLock = remoteControlSendLock(
    currentRun,
    desks,
    deskBridge()?.canRunLocal ? { thisDeskId: deskTarget.deskId } : undefined,
  );
  const activity = activityLabel({
    sending,
    stopping,
    status: currentRun?.status,
    streaming: isAssistantStreaming(viewMessages),
    runningTool: runningToolName(viewMessages),
  });
  const statusView = turnStatusLabel({ sending, stopping, status: currentRun?.status });
  const pr = currentRun?.pullRequests?.[0] as PullRequest | undefined;
  const gitContext = currentRun ? runGitContext(currentRun) : "none";
  const gitRefreshKey = `${runId ?? ""}:${busy ? "busy" : "idle"}:${currentRun?.pullRequests?.length ?? 0}`;
  const searchHits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return runs
      .filter((run) => {
        if (!q) return true;
        const projectName = (run.projectId && projectNames[run.projectId]) || "";
        return (
          (run.title ?? "").toLowerCase().includes(q) ||
          run.prompt.toLowerCase().includes(q) ||
          run.id.toLowerCase().includes(q) ||
          projectName.toLowerCase().includes(q)
        );
      })
      .slice(0, 12)
      .map((run) => ({
        id: run.id,
        title: runListTitle(run),
        meta: projectNames[run.projectId ?? ""] || run.status,
      }));
  }, [projectNames, runs, searchQuery]);
  const searchProjectHits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return Object.entries(projectNames)
      .filter(([, name]) => !q || name.toLowerCase().includes(q))
      .slice(0, 8)
      .map(([id, name]) => ({ id, title: name, meta: "项目工作台" }));
  }, [projectNames, searchQuery]);
  useEffect(() => {
    if (inspectorTab === "git" && gitContext === "none") setInspectorTab("terminal");
  }, [gitContext, inspectorTab]);
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

  const loadInspector = (id: InspectorTab) => {
    if (!runId) return;
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
    if (id === "files") {
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

  const railNow = () => (narrow ? 0 : sidebarOpen ? sidebarWidth : 48);
  const openInspector = (requested: InspectorTab) => {
    if (!runId) return;
    const id = requested === "git" && gitContext === "none" ? "terminal" : requested;
    setLastPane(id);
    if (!inspectorTab) {
      setPaneFull(false);
      setPaneSnap("idle");
      setPaneWidth(paneDefault(window.innerWidth, railNow()));
    }
    setInspectorTab(id);
    loadInspector(id);
  };
  const onPaneWidth = (next: number) => {
    setPaneWidth(next);
    if (narrow) return;
    setPaneSnap(paneSnapPhase(next, window.innerWidth, railNow()));
  };
  const onPaneDragEnd = (next: number) => {
    if (!narrow && paneSnapPhase(next, window.innerWidth, railNow()) !== "idle") {
      setPaneSnap("idle");
      setPaneFull(true);
      return;
    }
    setPaneSnap("idle");
    setPaneWidth(next);
  };
  const motionReduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sidebarPeekRef = useRef(false);
  const sidebarShownRef = useRef(false);
  const sidebarTimer = useRef<number | null>(null);
  const sidebarFrame = useRef(0);
  const sidebarOpenRef = useRef(sidebarOpen);
  const narrowRef = useRef(narrow);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarOpenRef.current = sidebarOpen;
  narrowRef.current = narrow;
  sidebarWidthRef.current = sidebarWidth;
  const showSidebarPeek = () => {
    if (narrowRef.current || sidebarOpenRef.current) return;
    const wasClosing = sidebarTimer.current != null;
    if (sidebarTimer.current != null) {
      window.clearTimeout(sidebarTimer.current);
      sidebarTimer.current = null;
    }
    if (sidebarPeekRef.current) {
      if (sidebarShownRef.current || !wasClosing) return;
      sidebarShownRef.current = true;
      setSidebarMotion(true);
      setSidebarShown(true);
      return;
    }
    sidebarPeekRef.current = true;
    sidebarShownRef.current = false;
    setSidebarMotion(false);
    setSidebarShown(false);
    setSidebarPeek(true);
    const frame = ++sidebarFrame.current;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (frame !== sidebarFrame.current || !sidebarPeekRef.current || sidebarOpenRef.current) return;
        sidebarShownRef.current = true;
        setSidebarMotion(true);
        setSidebarShown(true);
      });
    });
  };
  const hideSidebarPeek = () => {
    if (sidebarOpenRef.current || !sidebarPeekRef.current || sidebarTimer.current != null) return;
    sidebarFrame.current += 1;
    sidebarShownRef.current = false;
    setSidebarShown(false);
    const delay = motionReduced() ? 0 : 200;
    sidebarTimer.current = window.setTimeout(() => {
      sidebarTimer.current = null;
      if (sidebarShownRef.current) return;
      sidebarPeekRef.current = false;
      setSidebarPeek(false);
      setSidebarMotion(false);
    }, delay);
  };
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!narrowRef.current && !sidebarOpenRef.current) {
        const edge = sidebarPeekRef.current ? sidebarWidthRef.current + 8 : 48;
        if (event.clientX <= edge) showSidebarPeek();
        else hideSidebarPeek();
      }
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(() => {
    const syncPane = () => {
      const rail = narrow ? 0 : sidebarOpen ? sidebarWidth : 48;
      const limit = paneCeiling(window.innerWidth, rail);
      setPaneMaxWidth(limit);
      setPaneWidth((current) => clampPane(current, window.innerWidth, rail));
    };
    syncPane();
    window.addEventListener("resize", syncPane);
    return () => window.removeEventListener("resize", syncPane);
  }, [narrow, sidebarOpen, sidebarWidth]);

  const openContextDetail = (bucketId?: string) => {
    setContextFocusId(bucketId ?? "");
    setMainTab("context");
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
    if (action === "settings") {
      openSettings();
      return;
    }
    if (action === "repo") {
      if (runId || sending || pendingTurn) return;
      setRepoPickerOpen(true);
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
    }
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
    if (
      !(await confirm({
        title: "删除这条对话？",
        message: "删除后任务会从列表消失。",
        confirmLabel: "删除",
        danger: true,
      }))
    ) {
      return;
    }
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
          transcriptUrl(runId, { before }),
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
    sidebarPeekRef.current = false;
    sidebarShownRef.current = false;
    sidebarFrame.current += 1;
    if (sidebarTimer.current != null) {
      window.clearTimeout(sidebarTimer.current);
      sidebarTimer.current = null;
    }
    setSidebarPeek(false);
    setSidebarMotion(false);
    setSidebarShown(false);
    if (narrow) topMoreRef.current?.removeAttribute("open");
    setSidebarOpen((value) => {
      const next = !value;
      window.localStorage.setItem("neo.sidebar", next ? "1" : "0");
      return next;
    });
  };

  return (
    <>
      <div
        className={`${sidebarOpen ? "app" : "app sidebar-closed"}${!sidebarOpen && sidebarPeek ? " is-sidebar-peek" : ""}${sidebarMotion ? " is-sidebar-motion" : ""}${sidebarShown ? " is-sidebar-shown" : ""}${narrow ? " is-buddy" : ""}`}
        style={{ ["--sidebar-w" as string]: `${sidebarWidth}px`, ["--pane-w" as string]: `${paneWidth}px` }}
      >
        {sidebarOpen ? <div className="sidebar-backdrop" id="sidebar-backdrop" onClick={toggleSidebar} /> : null}
        <Sidebar
          runs={runs}
          currentRunId={runId}
          slots={vms.slots}
          backend={vms.backend}
          userEmail={userEmail}
          displayName={userName}
          avatarUrl={userAvatar}
          authed={Boolean(userEmail)}
          authBusy={authBusy}
          health={healthText}
          streamDown={healthText.startsWith("事件流") || healthText === "控制面异常"}
          sidebarWidth={sidebarWidth}
          onSidebarWidth={setSidebarWidth}
          inbox={
            <InboxBell
              token={token}
              authed={Boolean(userEmail)}
              onOpenRun={(id) => {
                setMainTab("chat");
                void openRun(id);
              }}
              onOpenProject={(id) => openProjects(id)}
            />
          }
          menuRef={topMoreRef}
          accountMenu={
            <>
              <div className="account-vms">
                {slotMenuLines(vms.slots, runs).map((line) =>
                  line.runId ? (
                    <button key={line.id} type="button" className="account-slot" onClick={() => void openRun(line.runId!)}>
                      <IconComputer size={16} />
                      {line.label}
                    </button>
                  ) : (
                    <span key={line.id} className="account-slot">
                      <IconComputer size={16} />
                      {line.label}
                    </span>
                  ),
                )}
                {vms.slots.length === 0 ? (
                  <span className="account-slot">
                    <IconComputer size={16} />
                    当前没有 VM 槽
                  </span>
                ) : null}
              </div>
              {formatUsage(currentRun?.usage) ? (
                <span className="account-slot" id="usage-badge">
                  <IconInfo size={16} />
                  {formatUsage(currentRun?.usage)}
                </span>
              ) : null}
              {runId && currentRun?.executionTarget?.tools !== "desk" && currentRun?.executionTarget?.loop !== "desk" && deskBridge()?.canRunLocal ? (
                <button
                  className="ghost"
                  type="button"
                  title="未提交的改动不会带过去，先 commit 或 stash"
                  onClick={() => void handoffCurrent("desk")}
                >
                  <IconComputer size={16} />
                  切到本机
                </button>
              ) : null}
              {handoffError ? <span className="setup err">{handoffError}</span> : null}
              {narrow ? null : <TranscriptSearch messages={displayMessages} onJump={setHighlightId} />}
              <button
                className="ghost"
                id="archive-run"
                type="button"
                hidden={!runId || currentRun?.status === "ARCHIVED"}
                onClick={() => {
                  if (!runId) return;
                  void confirm({
                    title: "归档这条对话？",
                    message: "归档后会释放 VM。",
                    confirmLabel: "归档",
                    danger: true,
                  }).then((ok) => {
                    if (!ok) return;
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
                  });
                }}
              >
                <IconArchive size={16} />
                归档
              </button>
              <button
                className="ghost danger"
                id="delete-run"
                type="button"
                hidden={!runId || currentRun?.status !== "ARCHIVED"}
                onClick={() => {
                  if (!runId) return;
                  void deleteArchivedRun(runId).catch((error) => {
                    setMessages((prev) => [...prev, localErrorMessage(runId, error instanceof Error ? error.message : "删除失败")]);
                  });
                }}
              >
                <IconTrash size={16} />
                删除
              </button>
              <button
                className="ghost"
                id="toggle-settings"
                type="button"
                aria-current={mainTab === "settings" ? "page" : undefined}
                onClick={openSettings}
              >
                <IconGear size={14} />
                设置
              </button>
              {pr?.url ? (
                <a className="pr-link" id="pr-link" href={pr.url} target="_blank" rel="noreferrer">
                  <IconPr size={16} />
                  {pr.draft === false ? "PR" : "草稿 PR"}
                </a>
              ) : null}
            </>
          }
          pinnedIds={pinnedIds}
          projectNames={projectNames}
          buddy={narrow}
          target={deskTarget.kind === "desk" ? "desk" : "cloud"}
          deskDisabled={!deskBridge()?.canRunLocal && !desks.some((desk) => desk.online && desk.allowRemote === true && (desk.workspaces?.length ?? 0) > 0)}
          onTarget={(value) => applyTarget({ ...deskTarget, kind: value })}
          nav={mainTab}
          onOpenNav={(id) => {
            if (narrow) setSidebarOpen(false);
            if (id === "automations") openAutomations();
            if (id === "experts") openExperts();
            if (id === "projects") openProjects();
            if (id === "skills") openSkills();
            if (id === "memories") openMemories();
          }}
          onPin={(id) => setPinnedIds(togglePinnedRun(id))}
          onArchiveMany={(ids) => void archiveMany(ids)}
          onDeleteRun={(id) => {
            void deleteArchivedRun(id).catch((error) => {
              setMessages((prev) => [...prev, localErrorMessage(runId, error instanceof Error ? error.message : "删除失败")]);
            });
          }}
          sidebarOpen={sidebarOpen}
          onToggle={toggleSidebar}
          onNewChat={() => {
            setActiveProject(null);
            setMainTab("chat");
            resetComposer();
            setSidebarOpen((open) => {
              if (!closeMobileSidebar()) return open;
              return false;
            });
          }}
          onStartProjectChat={(id) => {
            startProjectChat({
              id,
              name: projectNames[id] || "项目对话",
            });
            setSidebarOpen((open) => {
              if (!closeMobileSidebar()) return open;
              return false;
            });
          }}
          onStartRepoChat={(repoUrl) => {
            startRepoChat(repoUrl);
            setSidebarOpen((open) => {
              if (!closeMobileSidebar()) return open;
              return false;
            });
          }}
          onPatchTitle={async (id, body) => {
            const response = await api(token, `/v1/runs/${id}`, { method: "PATCH", body: JSON.stringify(body) });
            const updated = await readJson<Run & { error?: string }>(response);
            if (!response.ok || updated.error) {
              throw new Error(updated.error || "重命名失败");
            }
            setCurrentRun((run) => (run && run.id === updated.id ? { ...run, ...updated } : run));
            setRuns((prev) => prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
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
            setUserName("");
            setUserAvatar(null);
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
          <div
            className={`workspace-col${mainTab === "chat" && inspectorTab ? " has-inspector" : ""}${paneFull && inspectorTab ? " is-fullscreen" : ""}`}
          >
          {paneSnap !== "idle" && !paneFull ? (
            <div className="pane-snap" role="status">
              <span className="pane-snap-label">松开进入全屏</span>
            </div>
          ) : null}
          <div className="chat-column">
          <header className="topbar">
            <div className="topbar-lead">
              {narrow ? (
                <button type="button" className="icon-btn buddy-menu" aria-label="打开对话列表" title="对话列表" onClick={toggleSidebar}>
                  <IconSidebarOpen size={16} />
                </button>
              ) : null}
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
                      : mainTab === "settings"
                      ? "设置"
                      : mainTab === "context"
                      ? "上下文"
                      : currentRun
                        ? [
                            currentRun.buildId
                              ? `${currentRun.branchName ?? shortId(currentRun.id)} · 快照 ${shortId(currentRun.buildId)}`
                              : currentRun.branchName ?? shortId(currentRun.id),
                            runRoleLabel(currentRun, experts, teams),
                            formatRunTime(currentRun.createdAt, currentRun.updatedAt),
                          ]
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
                      ? "记忆"
                      : mainTab === "automations"
                      ? "到点自动开对话"
                      : mainTab === "settings"
                      ? "仓库、模型和集成"
                      : mainTab === "context"
                      ? "这次对话占了什么"
                      : currentRun
                        ? runListTitle(currentRun)
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
              {mainTab === "chat" && currentRun?.projectId ? (
                <RunInvite token={token} run={currentRun} userId={userId} />
              ) : null}
              {isDeskApp() ? (
                <span className="desk-badge" title="Desk 预览，本机执行可用">
                  Desk
                </span>
              ) : null}
              <div className="status-menu">
                {narrow && mainTab === "chat" && (busy || currentRun) ? (
                  <span id="status" className={busy ? "buddy-status-pill is-busy" : "buddy-status-pill"} tabIndex={0} data-state={statusView.state} data-busy={busy ? "true" : "false"}>
                    {busy ? "跑着" : statusView.label}
                  </span>
                ) : (
                  <span className="status" id="status" tabIndex={0} data-state={statusView.state} data-busy={busy ? "true" : "false"}>
                    {busy ? <span className="pulse-dot" aria-hidden="true" /> : null}
                    {statusView.label}
                  </span>
                )}
                <div className="status-pop" role="menu" aria-label="虚拟机槽">
                  {slotMenuLines(vms.slots, runs).map((line) =>
                    line.runId ? (
                      <button key={line.id} type="button" onClick={() => void openRun(line.runId!)}>
                        {line.label}
                      </button>
                    ) : (
                      <span key={line.id}>{line.label}</span>
                    ),
                  )}
                  {vms.slots.length === 0 ? <span>当前没有 VM 槽</span> : null}
                </div>
              </div>
              {!narrow && mainTab === "chat" && runId ? (
                <button
                  type="button"
                  className="pane-toggle icon-btn"
                  aria-label={inspectorTab ? "收起侧栏" : "打开侧栏"}
                  title={inspectorTab ? "收起侧栏" : "打开侧栏"}
                  onClick={() => {
                    if (inspectorTab) {
                      setPaneSnap("idle");
                      setPaneFull(false);
                      setInspectorTab(null);
                      return;
                    }
                    openInspector(lastPane);
                  }}
                >
                  <IconPanelRight size={16} />
                </button>
              ) : narrow && mainTab === "chat" && runId && !inspectorTab ? (
                <button type="button" className="icon-btn" aria-label="打开侧栏" title="打开侧栏" onClick={() => openInspector(lastPane)}>
                  <IconPanelRight size={16} />
                </button>
              ) : null}
            </div>
          </header>
          <div className="workspace-stage" {...(narrow && inspectorTab ? { inert: "" } : {})}>
            {mainTab === "settings" ? (
              <section className="proj-page catalog-page settings-page" id="settings-page">
                <header className="proj-page-head">
                  <div>
                    <button className="catalog-back" type="button" onClick={openChat}>
                      <IconBack />
                      返回对话
                    </button>
                    <h2>设置</h2>
                    <p className="hint">仓库、模型、配额和集成。每组各自保存，立刻生效。</p>
                  </div>
                </header>
                <SettingsPanel
                  repo={repo}
                  envId={envId}
                  buildId={buildId}
                  environments={environments}
                  builds={builds}
                  llm={llm}
                  llmKey={llmKey}
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
                  models: saved.models ?? llm.models,
                  modelsSource: saved.modelsSource ?? llm.modelsSource,
                });
                setLlmKey("");
                const nextHealth = await readJson<Health>(await fetch("/health"));
                setHealth(nextHealth);
                setHealthText(formatHealth(nextHealth, vms));
                toast("模型设置已保存");
              })().catch((error) => {
                toast(error instanceof Error ? error.message : "保存失败", "err");
              });
            }}
                  token={token}
                  onWarm={() => {
                    void (async () => {
                      const warmRepo = repo.trim();
                      if (!warmRepo) {
                        toast("预热前先填写仓库。", "err");
                        return;
                      }
                      const created = await readJson<{ id?: string; status?: string; error?: string; failureMessage?: string }>(
                        await api(token, "/v1/builds", {
                          method: "POST",
                          body: JSON.stringify({ repoUrls: [warmRepo], envId: envId || undefined }),
                        }),
                      );
                      if (created.error) throw new Error(created.error);
                      await refreshEnvironments();
                      if (created.id && created.status === "SUCCEEDED") setBuildId(created.id);
                      toast(created.status === "SUCCEEDED" ? "预热完成" : "已开始预热");
                    })().catch((error) => {
                      toast(error instanceof Error ? error.message : "预热失败", "err");
                    });
                  }}
                />
              </section>
            ) : mainTab === "projects" ? (
              <ProjectsPage
                token={token}
                userId={userId}
                inviteToken={inviteToken}
                selectedId={selectedProjectId}
                assetsTab={projectAssetsTab}
                highlightAssetId={highlightAssetId}
                onOpenProject={(id, opts) => openProjects(id, opts)}
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
              <MemoriesPage token={token} />
            ) : mainTab === "automations" ? (
              <AutomationsPage
                token={token}
                onOpenRun={(id) => {
                  setMainTab("chat");
                  void openRun(id);
                }}
              />
            ) : mainTab === "context" ? (
              <ContextUsagePanel
                usage={contextUsage}
                focusBucketId={contextFocusId}
                onBack={openChat}
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
                    token={token}
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
                    onOpenArtifact={(name) => {
                      setArtifactFocus(name);
                      setFilesView("artifacts");
                      openInspector("files");
                    }}
                    onPickRecipe={applyRecipe}
                    viewer={{ id: userId, email: userEmail }}
                  />
                )}
              </ChatErrorBoundary>
            )}
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
              contextUsage={contextUsage}
              onOpenContextDetail={openContextDetail}
              target={deskTarget}
              canRunLocal={Boolean(deskBridge()?.canRunLocal)}
              folder={deskFolder}
              desks={desks}
              targetLocked={isDeskHostedTarget(currentRun?.executionTarget) || projectCloudLock}
              targetLockLabel={
                isDeskHostedTarget(currentRun?.executionTarget)
                  ? isRemoteControlTarget(currentRun?.executionTarget)
                    ? "Remote Control"
                    : "This Computer"
                  : projectCloudLock
                    ? "云端"
                    : undefined
              }
              blocked={hostLock.locked}
              blockedHint={hostLock.hint}
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
              onExpert={(value) => setExpertPick(decodeExpertPick(value))}
              models={llm.models?.length ? llm.models : CHAT_MODELS}
              onModel={(value) =>
                setLlm((prev) => ({
                  ...prev,
                  model: value,
                  upstream: upstreamForChatModel(value, prev.upstream),
                }))
              }
              onPrompt={setPrompt}
              onImages={setImages}
              onSend={() => void sendMessage()}
              onQueue={() => void followUpWhileBusy("follow_up")}
              onSteer={() => void followUpWhileBusy("steer")}
              onStop={stopTurn}
              layout={narrow ? "buddy" : "default"}
              followUp={Boolean(runId)}
              onOpenPlus={() => setPlusOpen(true)}
              onAttach={() => imagePickRef.current?.click()}
              repoMode={repoMode}
              repo={repo}
              recentRepos={recentRepos}
              githubRepos={githubRepos}
              githubReposLoading={githubReposLoading}
              githubReposConfigured={githubReposConfigured}
              repoQuery={repoQuery}
              repoLocked={Boolean(runId || sending || pendingTurn)}
              branch={runId ? currentRun?.branchName ?? "" : ""}
              repoPickerOpen={repoPickerOpen}
              onRepoMode={setRepoMode}
              onRepo={setRepo}
              onRepoQuery={setRepoQuery}
              onRepoPickerOpen={setRepoPickerOpen}
              onOpenGithubSettings={openSettings}
            />
          ) : null}
          </div>
          {mainTab === "chat" && runId && !inspectorTab ? (
            <button type="button" className="pane-edge" aria-label="打开侧栏" onClick={() => openInspector(lastPane)} />
          ) : null}
          {mainTab === "chat" && runId && inspectorTab ? (
            <InspectorShell
              tab={inspectorTab}
              hasGit={gitContext !== "none"}
              width={paneWidth}
              maxWidth={paneMaxWidth}
              fullscreen={paneFull}
              onWidth={onPaneWidth}
              onDragEnd={onPaneDragEnd}
              onSelect={openInspector}
              onToggleFullscreen={() => {
                setPaneSnap("idle");
                if (paneFull) {
                  setPaneWidth(paneDefault(window.innerWidth, railNow()));
                  setPaneFull(false);
                  return;
                }
                setPaneFull(true);
              }}
              onClose={() => {
                setPaneFull(false);
                setInspectorTab(null);
              }}
            >
              {inspectorTab === "git" && gitContext !== "none" ? (
                <GitPanel
                  token={token}
                  runId={runId}
                  context={gitContext}
                  refreshKey={gitRefreshKey}
                  busy={busy}
                  onPullRequests={applyPullRequests}
                />
              ) : inspectorTab === "terminal" ? (
                <TerminalPanel
                  token={token}
                  runId={runId}
                  setupLoading={diagLoading}
                  setupError={diagError}
                  setupLogs={diagLogs}
                />
              ) : (
                <WorkspaceFiles view={filesView} onView={setFilesView}>
                  {filesView === "tree" ? (
                    <FileTree token={token} runId={runId} />
                  ) : (
                    <ArtifactsPanel
                      loading={artifactsLoading}
                      error={artifactsError}
                      artifacts={artifacts}
                      projectId={currentRun?.projectId ?? activeProject?.id}
                      token={token}
                      runId={runId}
                      focusName={artifactFocus}
                      onSaved={(asset) => {
                        const projectId = asset.projectId || currentRun?.projectId || activeProject?.id;
                        if (projectId && token) {
                          void api(token, `/v1/projects/${encodeURIComponent(projectId)}/assets`).then(async (response) => {
                            if (!response.ok) return;
                            const body = await readJson<{ assets?: ProjectAsset[] }>(response);
                            setProjectAssets(body.assets ?? []);
                          });
                        }
                        if (projectId && asset.id) {
                          openProjects(projectId, { assets: true, assetId: asset.id });
                        }
                      }}
                      onOpen={
                        deskBridge()?.openPath
                          ? (item) => {
                              if (item.url) void deskBridge()?.openPath?.(item.url);
                            }
                          : undefined
                      }
                    />
                  )}
                </WorkspaceFiles>
              )}
            </InspectorShell>
          ) : null}
          </div>
          {narrow && mainTab === "chat" ? <p className="buddy-footer">内容由 AI 生成</p> : null}
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
      {searchOpen ? (
        <SessionSearch
          query={searchQuery}
          setQuery={setSearchQuery}
          hits={searchHits}
          projectHits={searchProjectHits}
          onOpenRun={(id) => {
            setSearchOpen(false);
            setSearchQuery("");
            void openRun(id);
          }}
          onOpenProject={(id) => {
            setSearchOpen(false);
            setSearchQuery("");
            openProjects(id);
          }}
          onClose={() => {
            setSearchOpen(false);
            setSearchQuery("");
          }}
        />
      ) : null}
      <BuddyPlusSheet
        open={plusOpen}
        hiddenActions={runId || sending || pendingTurn ? ["repo"] : []}
        onClose={() => setPlusOpen(false)}
        onAction={applyBuddyPlus}
      />
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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyRunEventsToMessages,
  DEFAULT_TRANSCRIPT_PAGE,
  displayTranscriptMessages,
  settleTranscriptMessages,
} from "@neo-cloud-agent/contracts/transcript";
import type { RunEvent, TranscriptMessage, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import type { AgentMode, ImageRef, Run } from "@neo-cloud-agent/contracts/run";
import { api, hydrateDeskToken, readJson, readToken, writeToken } from "./api";
import { hasSavedSession } from "./session";
import { deskBridge, isDeskApp, withApiBase, type DeskTarget } from "./desk";
import { readPinnedRuns, togglePinnedRun } from "./pins";
import { readLastRunId, readLastTarget, writeLastRunId, writeLastTarget } from "./prefs";
import { cycle, shortcutAction } from "./shortcuts";
import { applyLiveEvents, parseSseData } from "./stream-apply";
import { AuthGate } from "./components/AuthGate";
import { ChatErrorBoundary } from "./components/ChatErrorBoundary";
import { ArtifactsPanel } from "./components/ArtifactsPanel";
import { Composer } from "./components/Composer";
import { DiffPanel } from "./components/DiffPanel";
import { FileTree } from "./components/FileTree";
import { TerminalPanel } from "./components/TerminalPanel";
import { AdminPage } from "./components/AdminPage";
import { AutomationsPage } from "./components/AutomationsPage";
import { ProjectsPage } from "./components/ProjectsPage";
import { SettingsPanel, type BuildOption, type EnvOption, type LlmSettings, type ScmSettings } from "./components/SettingsPanel";
import type { Project } from "@neo-cloud-agent/contracts/project";
import { Sidebar, type VmSlotView } from "./components/Sidebar";
import { Transcript } from "./components/Transcript";
import {
  baselineContextUsage,
  overlayContextUsage,
  parseContextUsage,
  resolveModelLimits,
} from "@neo-cloud-agent/contracts/context-usage";
import { formatRunTime, formatUsage, modelLabel, preview, resolveChatModel, shortId, slotLabel } from "./format";
import {
  activityLabel,
  isActiveRunStatus,
  isAssistantStreaming,
  isComposerClosed,
  isTerminalTurnEvent,
  isTurnBusy,
  pendingUserArrived,
  runningToolName,
  statusFromEventKind,
  turnStatusLabel,
  withPendingUser,
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
  workerRuntime?: string;
  objectStore?: string;
  scmPush?: ScmSettings;
  workerMemoryMiB?: number;
  vmSlots?: VmSummary;
};

type PullRequest = { url?: string; draft?: boolean };

function formatHealth(health: Health | null, vms: VmSummary): string {
  if (!health?.ok) return "控制面异常";
  const provider = health.llmConfigured
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

function hashAdmin(): boolean {
  return location.hash === "#/admin";
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

function initialMainTab(): "chat" | "automations" | "projects" | "admin" {
  if (hashAdmin()) return "admin";
  if (hashAutomations()) return "automations";
  if (hashProjects()) return "projects";
  return "chat";
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [authOpen, setAuthOpen] = useState(() => !hasSavedSession(readToken()));
  const [authMode, setAuthMode] = useState<"login" | "token">("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<ImageRef[]>([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
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
  const [sessionTab, setSessionTab] = useState<"chat" | "diff" | "terminal" | "artifacts">("chat");
  const [agentMode, setAgentMode] = useState<AgentMode>("agent");
  const [deskTarget, setDeskTarget] = useState<DeskTarget>({ kind: "cloud" });
  const [deskFolder, setDeskFolder] = useState("");
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
  const [mainTab, setMainTab] = useState<"chat" | "automations" | "projects" | "admin">(initialMainTab);
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
  const topMoreRef = useRef<HTMLDetailsElement>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const streamFrameRef = useRef(0);
  const streamTimerRef = useRef(0);
  const lastEventIdRef = useRef<string | null>(null);
  const appliedEventIdsRef = useRef<Set<string>>(new Set());
  const openGenRef = useRef(0);
  const listenRef = useRef<(id: string, after?: string | null) => void>(() => undefined);
  const tokenRef = useRef(token);
  const sendingRef = useRef(false);
  const pendingRef = useRef<PendingUser | null>(null);
  const keepPendingRef = useRef(false);
  tokenRef.current = token;
  sendingRef.current = sending;
  pendingRef.current = pendingTurn;

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
      source.onmessage = (message) => {
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
    setFilesOpen(false);
    setDiffOpen(false);
    setSessionTab("chat");
    setDiffStat("");
    setDiffPatch("");
    setDiffError("");
    setSending(false);
    setStopping(false);
    setPendingTurn(null);
    setEnvId("");
    setBuildId("");
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
        setActiveProject((prev) => (prev?.id === projectId ? prev : { id: projectId, name: prev?.name ?? "项目对话" }));
      } else {
        setActiveProject(null);
      }
      setRepo(run.repoUrls?.[0] ?? "");
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
        setMessages(isActiveRunStatus(run.status) ? loaded : settleTranscriptMessages(loaded));
        setRemaining(snapshot?.remaining ?? 0);
        setNextBefore(snapshot?.nextBefore ?? snapshot?.messages?.[0]?.id ?? null);
        lastEventIdRef.current = snapshot?.lastEventId ?? null;
      } else {
        setMessages([]);
        lastEventIdRef.current = null;
      }
      setLoadingTranscript(false);
      listen(run.id, lastEventIdRef.current);
      void refreshVms();
      return true;
    },
    [listen, refreshVms],
  );

  const openAutomations = useCallback(() => {
    setMainTab("automations");
    setFilesOpen(false);
    setDiffOpen(false);
    setSettingsOpen(false);
    history.replaceState(null, "", "/#/automations");
  }, []);

  const openAdmin = useCallback(() => {
    setMainTab("admin");
    setFilesOpen(false);
    setDiffOpen(false);
    setSettingsOpen(false);
    history.replaceState(null, "", "/#/admin");
  }, []);

  const openProjects = useCallback((id?: string | null, invite?: string | null) => {
    setMainTab("projects");
    setFilesOpen(false);
    setDiffOpen(false);
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
    if (hashAutomations() || hashProjects() || hashAdmin()) {
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
    const refreshShell = [refreshRuns(), refreshEnvironments(), refreshLlm(), refreshScm(), refreshVms()] as const;
    if (hashAdmin()) {
      const me = await api(tokenRef.current, "/v1/me");
      const body = me.ok ? await readJson<{ admin?: boolean }>(me) : { admin: false };
      setIsAdmin(Boolean(body.admin));
      if (body.admin) {
        setMainTab("admin");
      } else {
        history.replaceState(null, "", "/");
        setMainTab("chat");
      }
      await Promise.all(refreshShell);
      return;
    }
    if (hashAutomations()) {
      setMainTab("automations");
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
    ]);
    if (!match && !hashRunId() && !hashProjects()) resetComposer();
  }, [openRun, refreshEnvironments, refreshLlm, refreshRuns, refreshScm, refreshVms, resetComposer]);

  const applySession = useCallback(
    async (nextToken: string, user?: { id?: string; email?: string } | null) => {
      if (!nextToken) throw new Error("登录响应缺少会话");
      persistToken(nextToken);
      const me = await api(nextToken, "/v1/me");
      if (!me.ok) {
        persistToken("");
        setUserEmail("");
        setUserId("");
        setIsAdmin(false);
        throw new Error("unauthorized");
      }
      const body = await readJson<{ user?: { id?: string; email?: string }; admin?: boolean }>(me);
      const nextUser = body.user ?? user;
      if (!nextUser?.email && !body.admin) {
        persistToken("");
        setUserEmail("");
        setUserId("");
        setIsAdmin(false);
        throw new Error("登录未生效，请再试一次");
      }
      setUserEmail(nextUser?.email ?? "");
      setUserId(nextUser?.id ?? "");
      setIsAdmin(Boolean(body.admin));
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
    const repoUrls = repo.trim() ? [repo.trim()] : [];
    const model = resolveChatModel(llm.upstream, llm.model, attached.length > 0);
    const buildPayload = buildId === "cold" ? { reuseBuild: false } : buildId ? { buildId, reuseBuild: true } : { reuseBuild: true };
    try {
      if (!runId) {
        const created = await readJson<Run & { error?: string }>(
          await api(tokenRef.current, "/v1/runs", {
            method: "POST",
            body: JSON.stringify({
              prompt: `${askPrefix}${text || "（图片）"}`,
              repoUrls: deskTarget.kind === "desk" ? (repoUrls.length ? repoUrls : deskFolder ? [deskFolder] : []) : repoUrls,
              source: deskTarget.kind === "desk" ? "desk" : "web",
              envId: envId || undefined,
              model,
              images: attached.length ? attached : undefined,
              projectId: activeProject?.id,
              mode: agentMode,
              target:
                deskTarget.kind === "desk"
                  ? { loop: "desk", tools: "desk", deskId: deskTarget.deskId }
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
  }, [activeProject?.id, agentMode, buildId, currentRun?.status, deskFolder, deskTarget, envId, images, llm.model, llm.upstream, openRun, patchRun, prompt, repo, runId, messages, stopping]);

  const queueMessage = useCallback(async () => {
    const text = prompt.trim();
    if (!text && images.length === 0) return;
    if (isComposerClosed(currentRun?.status) || !runId) return;
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
  }, [agentMode, currentRun?.status, images, prompt, runId]);

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

  const handoffCurrent = useCallback(
    async (kind: "cloud" | "desk") => {
      if (!runId) return;
      const warning = "未提交的改动不会带过去，先 commit 或 stash。确定？";
      if (!window.confirm(kind === "cloud" ? `切到云端。${warning}` : `切到本机。${warning}`)) {
        return;
      }
      setHandoffError("");
      try {
        const target =
          kind === "desk"
            ? { loop: "desk" as const, tools: "desk" as const, deskId: deskTarget.deskId }
            : { loop: "cloud" as const, tools: "cloud" as const };
        const body = await readJson<Run & { error?: string }>(
          await api(tokenRef.current, `/v1/runs/${runId}/handoff`, {
            method: "POST",
            body: JSON.stringify({ target }),
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
      })();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [applyVms, refreshRuns, refreshVms, runId]);

  useEffect(() => () => closeStream(), [closeStream]);

  useEffect(() => {
    const syncHash = () => {
      const invite = hashInviteToken();
      const projectId = hashProjectId();
      if (hashAdmin()) {
        setMainTab("admin");
        setInviteToken(null);
        setFilesOpen(false);
        setDiffOpen(false);
        setSettingsOpen(false);
        return;
      }
      if (hashAutomations()) {
        setMainTab("automations");
        setInviteToken(null);
        setFilesOpen(false);
        setDiffOpen(false);
        setSettingsOpen(false);
        return;
      }
      if (invite || projectId || location.hash === "#/projects") {
        setMainTab("projects");
        setInviteToken(invite);
        setSelectedProjectId(projectId);
        setFilesOpen(false);
        setDiffOpen(false);
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
  const activity = activityLabel({
    sending,
    stopping,
    status: currentRun?.status,
    streaming: isAssistantStreaming(messages),
    runningTool: runningToolName(messages),
  });
  const statusView = turnStatusLabel({ sending, stopping, status: currentRun?.status });
  const pr = currentRun?.pullRequests?.[0] as PullRequest | undefined;
  const currentSlot = currentRun?.vmSlotId || vms.slots.find((slot) => slot.runId === runId)?.id || null;
  const vmHint = !vms.total && vms.slots.length === 0
    ? "未启用 VM 槽。"
    : currentSlot
      ? `当前对话占用 ${slotLabel(currentSlot)}（${currentSlot}，${vms.backend === "loop" ? "loop 挂载" : vms.backend}）`
      : Math.max(0, (vms.total || vms.slots.length) - vms.busy) > 0
        ? `${Math.max(0, (vms.total || vms.slots.length) - vms.busy)}/${vms.total || vms.slots.length} 个 VM 空闲，发送后占用其中一个（${vms.backend === "loop" ? "loop 挂载" : vms.backend}）。`
        : `${vms.total || vms.slots.length} 个 VM 都在忙。新对话会排队，有空闲槽再自动开始。`;

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
    setSidebarOpen((value) => {
      const next = !value;
      window.localStorage.setItem("neo.sidebar", next ? "1" : "0");
      return next;
    });
  };

  return (
    <>
      <div className={sidebarOpen ? "app" : "app sidebar-closed"}>
        {sidebarOpen ? <div className="sidebar-backdrop" id="sidebar-backdrop" onClick={toggleSidebar} /> : null}
        <Sidebar
          runs={runs}
          currentRunId={runId}
          slots={vms.slots}
          backend={vms.backend}
          userEmail={userEmail}
          authed={Boolean(userEmail)}
          authBusy={authBusy}
          health={healthText}
          pinnedIds={pinnedIds}
          onPin={(id) => setPinnedIds(togglePinnedRun(id))}
          onClose={toggleSidebar}
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
            setIsAdmin(false);
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
              <button
                className="ghost sidebar-toggle"
                id="sidebar-toggle"
                type="button"
                aria-label={sidebarOpen ? "收起侧栏" : "打开对话列表"}
                onClick={toggleSidebar}
              >
                <span aria-hidden="true">{sidebarOpen ? "‹" : "☰"}</span>
                <span className="sidebar-toggle-label">{sidebarOpen ? "收起侧栏" : "对话列表"}</span>
              </button>
              <nav className="app-tabs" id="app-tabs" aria-label="主导航">
                <button
                  type="button"
                  className={mainTab === "chat" ? "active" : ""}
                  aria-current={mainTab === "chat" ? "page" : undefined}
                  onClick={openChat}
                >
                  对话
                </button>
                <button
                  type="button"
                  className={mainTab === "projects" ? "active" : ""}
                  aria-current={mainTab === "projects" ? "page" : undefined}
                  onClick={() => openProjects()}
                >
                  项目
                </button>
                <button
                  type="button"
                  className={mainTab === "automations" ? "active" : ""}
                  aria-current={mainTab === "automations" ? "page" : undefined}
                  onClick={openAutomations}
                >
                  定时任务
                </button>
                {isAdmin ? (
                  <button
                    type="button"
                    className={mainTab === "admin" ? "active" : ""}
                    aria-current={mainTab === "admin" ? "page" : undefined}
                    onClick={openAdmin}
                  >
                    管理台
                  </button>
                ) : null}
              </nav>
              <div className="topbar-heading">
                <p className="eyebrow" id="run-label">
                  {mainTab === "projects"
                    ? "项目"
                    : mainTab === "automations"
                      ? "定时任务"
                      : mainTab === "admin"
                        ? "管理台"
                      : currentRun
                        ? [
                            currentRun.buildId
                              ? `${currentRun.branchName ?? shortId(currentRun.id)} · 快照 ${shortId(currentRun.buildId)}`
                              : currentRun.branchName ?? shortId(currentRun.id),
                            formatRunTime(currentRun.createdAt, currentRun.updatedAt),
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : activeProject
                          ? `项目 · ${activeProject.name}`
                          : "新对话"}
                </p>
                <h1 id="run-title">
                  {mainTab === "projects"
                    ? "人和 Agent 共用一份上下文"
                    : mainTab === "automations"
                      ? "到点自动开对话"
                      : mainTab === "admin"
                        ? "用户、容量和限流"
                      : currentRun
                        ? preview(currentRun.prompt)
                        : activeProject
                          ? `在「${activeProject.name}」里开对话`
                          : "和云端 Agent 说话"}
                </h1>
              </div>
            </div>
            <div className="top-actions">
              {isDeskApp() ? (
                <span className="desk-badge" title="Desk 预览，本机执行可用">
                  Desk
                </span>
              ) : null}
              <span className="status" id="status" data-state={statusView.state} data-busy={busy ? "true" : "false"}>
                {busy ? <span className="pulse-dot" aria-hidden="true" /> : null}
                {statusView.label}
              </span>
              <details className="top-more" ref={topMoreRef}>
                <summary className="ghost top-more-sum">更多</summary>
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
                    ["chat", "对话"],
                    ["diff", "Diff"],
                    ["terminal", "终端"],
                    ["artifacts", "产物"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={sessionTab === id ? "active" : ""}
                    aria-current={sessionTab === id ? "page" : undefined}
                    onClick={() => {
                      setSessionTab(id);
                      setFilesOpen(false);
                      setDiffOpen(id === "diff");
                      setSettingsOpen(false);
                      if (id === "diff" && runId) {
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
                      if (id === "terminal" && runId) {
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
                      if (id === "artifacts" && runId) {
                        setArtifactsLoading(true);
                        setArtifactsError("");
                        void (async () => {
                          const response = await api(token, `/v1/runs/${runId}/artifacts`);
                          const body = await readJson<{ artifacts?: Array<{ name: string; url?: string; contentType?: string }>; error?: string }>(
                            response,
                          );
                          if (!response.ok) throw new Error(body.error || "读取产物失败");
                          setArtifacts(body.artifacts ?? []);
                        })()
                          .catch((error) => setArtifactsError(error instanceof Error ? error.message : "读取产物失败"))
                          .finally(() => setArtifactsLoading(false));
                      }
                    }}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              {runId && currentRun?.executionTarget?.loop === "desk" ? (
                <button
                  className="ghost"
                  type="button"
                  title="未提交的改动不会带过去，先 commit 或 stash"
                  onClick={() => void handoffCurrent("cloud")}
                >
                  切到云端
                </button>
              ) : null}
              {runId && currentRun?.executionTarget?.loop !== "desk" && deskBridge()?.canRunLocal ? (
                <button
                  className="ghost"
                  type="button"
                  title="未提交的改动不会带过去，先 commit 或 stash"
                  onClick={() => void handoffCurrent("desk")}
                >
                  切到本机
                </button>
              ) : null}
              {handoffError ? <span className="setup err">{handoffError}</span> : null}
              <button
                className="ghost"
                id="archive-run"
                type="button"
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
                归档
              </button>
              <button
                className="ghost"
                id="toggle-settings"
                type="button"
                aria-expanded={settingsOpen}
                onClick={() => {
                  const next = !settingsOpen;
                  setSettingsOpen(next);
                  if (next) {
                    setFilesOpen(false);
                    setDiffOpen(false);
                  }
                }}
              >
                {settingsOpen ? "收起设置" : "设置"}
              </button>
              {pr?.url ? (
                <a className="pr-link" id="pr-link" href={pr.url} target="_blank" rel="noreferrer">
                  {pr.draft === false ? "PR" : "草稿 PR"}
                </a>
              ) : null}
              <button
                className="ghost"
                id="open-pr"
                type="button"
                hidden={Boolean(pr?.url) || !runId}
                onClick={async () => {
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
                }}
              >
                开草稿 PR
              </button>
                </div>
              </details>
            </div>
          </header>
          <div className="workspace-col">
          {settingsOpen ? (
            <aside className="workspace-drawer" id="workspace-drawer" role="dialog" aria-label="设置">
              <div className="workspace-drawer-bar">
                <strong>设置</strong>
                <button
                  type="button"
                  className="ghost"
                  id="close-drawer"
                  onClick={() => {
                    setFilesOpen(false);
                    setDiffOpen(false);
                    setSettingsOpen(false);
                  }}
                >
                  关闭
                </button>
              </div>
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
                if (!llmKey && !llm.configured) return;
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
                setLlm({ configured: saved.configured, upstream: saved.upstream, model: saved.model });
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
              <FileTree token={token} runId={runId} open={Boolean(runId)} />
            </aside>
          ) : null}
            {mainTab === "admin" ? (
              <AdminPage
                token={token}
                onOpenRun={(id) => {
                  setMainTab("chat");
                  void openRun(id);
                }}
              />
            ) : mainTab === "projects" ? (
              <ProjectsPage>
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
            ) : mainTab === "automations" ? (
              <AutomationsPage
                token={token}
                onOpenRun={(id) => {
                  setMainTab("chat");
                  void openRun(id);
                }}
              />
            ) : sessionTab === "diff" ? (
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
            ) : sessionTab === "terminal" ? (
              <TerminalPanel open loading={diagLoading} error={diagError} logs={diagLogs} />
            ) : sessionTab === "artifacts" ? (
              <ArtifactsPanel
                open
                loading={artifactsLoading}
                error={artifactsError}
                artifacts={artifacts}
                onOpen={
                  deskBridge()?.openPath
                    ? (item) => {
                        if (item.url) void deskBridge()?.openPath?.(item.url);
                      }
                    : undefined
                }
              />
            ) : (
              <ChatErrorBoundary onReset={() => (runId ? void openRun(runId) : resetComposer())}>
                <Transcript
                  messages={displayMessages}
                  remaining={remaining}
                  empty={!loadingTranscript && displayMessages.length === 0}
                  loading={loadingTranscript && displayMessages.length === 0}
                  loadingOlder={loadingOlder}
                  busy={busy}
                  activity={activity}
                  onLoadOlder={loadOlder}
                />
              </ChatErrorBoundary>
            )}
          </div>
          {mainTab === "chat" && activeProject ? (
            <div className="proj-chip-bar" id="project-chip">
              <span className="proj-chip">
                {runId ? `项目对话 · ${activeProject.name}` : `将在项目「${activeProject.name}」中开对话`}
              </span>
              {runId ? (
                <button type="button" className="ghost" onClick={() => openProjects(activeProject.id)}>
                  打开项目
                </button>
              ) : (
                <button type="button" className="ghost" onClick={() => setActiveProject(null)}>
                  不用项目
                </button>
              )}
            </div>
          ) : null}
          {mainTab === "chat" ? (
            <Composer
              prompt={prompt}
              images={images}
              vmHint={
                deskTarget.kind === "desk"
                  ? deskFolder
                    ? `本机 · ${deskFolder}`
                    : "本机执行需要先选一个 git 文件夹。"
                  : vmHint
              }
              busy={busy}
              stopping={stopping}
              archived={archived}
              canStop={Boolean(runId)}
              activity={activity}
              contextUsage={contextUsage}
              target={deskTarget}
              canRunLocal={Boolean(deskBridge()?.canRunLocal)}
              folder={deskFolder}
              mode={agentMode}
              model={selectedModel}
              onTarget={applyTarget}
              onPickFolder={() => {
                void deskBridge()?.pickFolder().then((folder) => {
                  if (folder) {
                    applyTarget({ ...deskTarget, kind: "desk", folder });
                  }
                });
              }}
              onMode={setAgentMode}
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
            />
          ) : null}
        </main>
      </div>
      <AuthGate
        open={authOpen}
        mode={authMode}
        busy={authBusy}
        error={authError}
        email={authEmail}
        password={authPassword}
        token={authToken}
        onMode={setAuthMode}
        onEmail={setAuthEmail}
        onPassword={setAuthPassword}
        onToken={setAuthToken}
        onSubmit={() => {
          if (authBusy) return;
          if (authMode === "token") {
            if (!authToken.trim()) {
              setAuthError("请输入服务令牌");
              return;
            }
          } else if (!authEmail.trim() || !authPassword) {
            setAuthError("请输入账号和密码");
            return;
          }
          setAuthBusy(true);
          void (async () => {
            if (authMode === "token") {
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
              await applySession(authToken.trim());
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
              setIsAdmin(false);
              setUserEmail("");
              setUserId("");
              setAuthError(error instanceof Error ? error.message : "登录失败");
              setAuthOpen(true);
            })
            .finally(() => setAuthBusy(false));
        }}
      />
    </>
  );
}

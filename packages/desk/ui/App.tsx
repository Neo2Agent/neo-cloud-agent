import type { FollowUp, PublicLlmSettings } from "@neo-cloud-agent/contracts";
import { decodeExpertPick, encodeExpertPick, type Expert, type ExpertPick, type ExpertTeam } from "@neo-cloud-agent/contracts/expert";
import type { Automation } from "@neo-cloud-agent/contracts/automation";
import type { RunEvent, TranscriptMessage, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { applyRunEventsToMessages, displayTranscriptMessages, settleTranscriptMessages } from "@neo-cloud-agent/contracts/transcript";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Select } from "@neo-cloud-agent/ui";
import { createPortal } from "react-dom";
import { api, persistSessionToken, readJson } from "./api";
import {
  asWorkspaceRef,
  deskBridge,
  STALE_DESK_HINT,
  withApiBase,
  type DeskRunStatus,
  type DeskTarget,
  type DeskWorkspaceRef,
} from "./desk";
import type { DeskAssignment } from "@neo-cloud-agent/contracts/desk";
import { isLoopbackOrigin } from "../src/ports";
import { groupRailSessions } from "../src/rail";
import {
  hashForProject,
  inviteTokenFromDeepLink,
  inviteTokenFromHash,
  projectIdFromHash,
  runIdFromDeepLink,
  runIdFromHash,
} from "../src/protocol";
import { ExpertsPage } from "./ExpertsPage";
import { SidePanel, type SidePanelTab } from "./SidePanel";
import { PersonalChatPage } from "./chat/PersonalChatPage";
import { RailSessions } from "./chat/RailSessions";
import { InviteAcceptPage } from "./project/InviteAcceptPage";
import { ProjectChatPage } from "./project/ProjectChatPage";
import { ProjectWorkbench } from "./project/ProjectWorkbench";
import type { WorkbenchTab } from "./project/types";
import {
  isActiveRunStatus,
  isTerminalTurnEvent,
  liveActivityLabel,
  parseSse,
  runEventsQuery,
} from "../src/stream";
import {
  AutomationCreateForm,
  AutomationsPage,
  ChatComposer,
  ContextBar,
  type ComposerMention,
  loadSavedModels,
  Modal,
  ModelSettingsPage,
  OPENAI_BASE_URL,
  ProjectCreateForm,
  ProjectsPage,
  rememberSavedModel,
  runSearchMeta,
  SCHEDULE_PRESETS,
  SearchPalette,
  type ContextMenuId,
  type SavedModel,
  type ScheduleKind,
  type SearchFilter,
} from "./pages";
import {
  IconAutomations,
  IconBack,
  IconComputer,
  IconExperts,
  IconForward,
  IconGear,
  IconNewChat,
  IconPanelRight,
  IconProjects,
  IconSearch,
  IconSort,
} from "./icons";

type NavId = "chats" | "automations" | "projects" | "experts" | "settings";

type InboxRow = {
  id: string;
  kind?: string;
  title: string;
  projectId?: string | null;
  runId?: string | null;
  todoId?: string | null;
  read: boolean;
};

function workbenchTabForInbox(kind?: string): WorkbenchTab {
  if (kind === "mention") return "activity";
  if (kind === "todo_assigned") return "board";
  if (kind === "invite_pending") return "settings";
  return "board";
}

function preview(text: string, n = 56): string {
  return (text || "New Agent").replace(/\s+/g, " ").slice(0, n);
}

/** Compare folder paths without caring about a trailing separator. */
function path0(value: string): string {
  return (value || "").replace(/[\\/]+$/, "");
}

function isLocalPathLike(value: string): boolean {
  return value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:[\\/]/.test(value);
}

function folderName(value: string): string {
  return path0(value).split(/[\\/]/).pop() || value;
}

function repoLabel(url?: string): string {
  if (!url) return "Inbox";
  try {
    const path = new URL(url).pathname.replace(/\.git$/, "");
    const name = path.split("/").filter(Boolean).pop();
    return name || url;
  } catch {
    const clean = url.replace(/\/$/, "").replace(/\.git$/, "");
    return clean.split("/").filter(Boolean).pop() || clean;
  }
}

function repoPath(url?: string): string {
  if (!url) return "Inbox";
  try {
    const parts = new URL(url).pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    return parts.slice(-2).join("/") || repoLabel(url);
  } catch {
    const parts = url.replace(/\/$/, "").replace(/\.git$/, "").split("/").filter(Boolean);
    return parts.slice(-2).join("/") || repoLabel(url);
  }
}

function initials(value: string): string {
  const parts = value.trim().split(/[@\s./_-]+/).filter(Boolean);
  if (parts.length === 0) return "N";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}

function formatRel(iso?: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

function isCloudRun(run?: Run | null): boolean {
  return run?.executionTarget?.loop !== "desk";
}

function diffStats(text: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

export function App() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState("");
  const [userId, setUserId] = useState("");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [pendingTodo, setPendingTodo] = useState<{ id: string; title: string } | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxItems, setInboxItems] = useState<InboxRow[]>([]);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("board");
  const [chatToolsOpen, setChatToolsOpen] = useState(false);
  const [mentions, setMentions] = useState<ComposerMention[]>([]);
  const [todoHits, setTodoHits] = useState<Array<{ id: string; title: string; meta: string; projectId: string }>>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [experts, setExperts] = useState<Expert[]>([]);
  const [teams, setTeams] = useState<ExpertTeam[]>([]);
  const [expertPick, setExpertPick] = useState<ExpertPick>({});
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectInstruction, setProjectInstruction] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectModal, setProjectModal] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [autoModal, setAutoModal] = useState(false);
  const [autoPrompt, setAutoPrompt] = useState("");
  const [autoPreset, setAutoPreset] = useState<ScheduleKind>("daily_09");
  const [autoBusy, setAutoBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Run | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [queuedFollowUps, setQueuedFollowUps] = useState<FollowUp[]>([]);
  const [queueEpoch, setQueueEpoch] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState<SearchFilter>("all");
  const [nav, setNav] = useState<NavId>("chats");
  const [target, setTarget] = useState<DeskTarget>({ kind: "cloud" });
  const [folder, setFolder] = useState("");
  const [mode] = useState<"agent" | "ask">("agent");
  const [llm, setLlm] = useState<PublicLlmSettings>({ configured: false, upstream: "mock", model: null, baseUrl: null });
  const [savedModels, setSavedModels] = useState<SavedModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelMenu, setModelMenu] = useState(false);
  const [modelName, setModelName] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [modelBaseUrl, setModelBaseUrl] = useState(OPENAI_BASE_URL);
  const [modelBusy, setModelBusy] = useState(false);
  const [composerRepo, setComposerRepo] = useState("");
  const [contextOpen, setContextOpen] = useState<ContextMenuId>(null);
  const [repoOpen, setRepoOpen] = useState<Record<string, boolean>>({});
  const [railInboxOpen, setRailInboxOpen] = useState(true);
  const [railSpacesOpen, setRailSpacesOpen] = useState(true);
  const [railInboxExpanded, setRailInboxExpanded] = useState(false);
  const [diff, setDiff] = useState<{ added: number; removed: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem("neo.desk.panel") === "1");
  const [panelTab, setPanelTab] = useState<SidePanelTab>(
    () => (localStorage.getItem("neo.desk.panelTab") as SidePanelTab) || "files",
  );
  const [panelEpoch, setPanelEpoch] = useState(0);
  const [localStatus, setLocalStatus] = useState<DeskRunStatus | null>(null);
  const [workspaces, setWorkspaces] = useState<DeskWorkspaceRef[]>([]);
  const [requireApproval, setRequireApproval] = useState(false);
  const [copied, setCopied] = useState("");
  const [trail, setTrail] = useState<{ ids: string[]; at: number }>({ ids: [], at: -1 });
  const tokenRef = useRef("");
  const sourceRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const streamFrameRef = useRef(0);
  const listenRef = useRef<(id: string, after?: string | null) => void>(() => undefined);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const canRunLocal = Boolean(deskBridge()?.canRunLocal);
  const apiBase = deskBridge()?.apiBase || "";
  const remoteApiHost = apiBase && !isLoopbackOrigin(apiBase) ? new URL(apiBase).host : "";

  const persist = useCallback((next: string) => {
    tokenRef.current = next;
    setToken(next);
    persistSessionToken(next);
  }, []);

  const refreshRuns = useCallback(async () => {
    const response = await api(tokenRef.current, "/v1/runs");
    if (!response.ok) return;
    const body = await readJson<{ runs?: Run[] }>(response);
    setRuns(body.runs ?? []);
  }, []);

  const refreshAutomations = useCallback(async () => {
    const response = await api(tokenRef.current, "/v1/automations");
    if (!response.ok) return;
    const body = await readJson<{ automations?: Automation[] }>(response);
    setAutomations(body.automations ?? []);
  }, []);

  const refreshInbox = useCallback(async () => {
    const response = await api(tokenRef.current, "/v1/inbox");
    if (!response.ok) return;
    const body = await readJson<{ items?: InboxRow[] }>(response);
    setInboxItems(body.items ?? []);
  }, []);

  const refreshProjects = useCallback(async () => {
    const response = await api(tokenRef.current, "/v1/projects");
    if (!response.ok) return;
    const body = await readJson<{ projects?: Project[] }>(response);
    setProjects(body.projects ?? []);
  }, []);

  const refreshExperts = useCallback(async (projectId?: string | null) => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const [expertRes, teamRes] = await Promise.all([
      api(tokenRef.current, `/v1/experts${query}`),
      api(tokenRef.current, "/v1/expert-teams"),
    ]);
    if (expertRes.ok) setExperts((await readJson<{ experts?: Expert[] }>(expertRes)).experts ?? []);
    if (teamRes.ok) setTeams((await readJson<{ teams?: ExpertTeam[] }>(teamRes)).teams ?? []);
  }, []);

  const openProject = useCallback(async (id: string, tab: WorkbenchTab = "board") => {
    const response = await api(tokenRef.current, `/v1/projects/${id}`);
    if (!response.ok) return;
    const detail = await readJson<Project>(response);
    setActiveProject(detail);
    setWorkbenchTab(tab);
    setInviteToken(null);
    setRunId(null);
    setCurrent(null);
    setNav("projects");
    if (location.hash !== hashForProject(detail.id)) {
      location.hash = hashForProject(detail.id);
    }
  }, []);

  const refreshLlm = useCallback(async () => {
    const response = await api(tokenRef.current, "/v1/settings/llm");
    if (!response.ok) return;
    const settings = await readJson<PublicLlmSettings & { error?: string }>(response);
    if (settings.error) return;
    const next: PublicLlmSettings = {
      configured: Boolean(settings.configured),
      upstream: settings.upstream || "mock",
      model: settings.model ?? null,
      baseUrl: settings.baseUrl ?? null,
      newApi: settings.newApi ?? { url: null, consoleUrl: null },
    };
    setLlm(next);
    const stored = loadSavedModels();
    setSavedModels(stored);
    const names = [next.model, ...stored.map((item) => item.name)].filter((item): item is string => Boolean(item));
    setSelectedModel((cur) => (cur && names.includes(cur) ? cur : names[0] || ""));
    if (next.model) setModelName(next.model);
    if (next.baseUrl) setModelBaseUrl(next.baseUrl);
  }, []);

  const closeStream = useCallback(() => {
    if (streamFrameRef.current) {
      cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = 0;
    }
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const listen = useCallback(
    (id: string, after?: string | null) => {
      closeStream();
      const cursor = after ?? lastEventIdRef.current;
      const query = runEventsQuery({ after: cursor, accessToken: tokenRef.current });
      const source = new EventSource(withApiBase(`/v1/runs/${id}/events${query}`));
      const pending: RunEvent[] = [];
      const flush = () => {
        streamFrameRef.current = 0;
        if (sourceRef.current !== source) return;
        const batch = pending.splice(0);
        if (batch.length === 0) return;
        setMessages((prev) => {
          const next = applyRunEventsToMessages(prev, batch);
          return batch.some((event) => isTerminalTurnEvent(event.kind)) ? settleTranscriptMessages(next) : next;
        });
        if (batch.some((event) => event.kind === "run.idle" || event.kind === "run.error")) {
          void refreshRuns();
        }
        if (batch.some((event) => event.kind === "followup.queued" || event.kind === "followup.delivered")) {
          setQueueEpoch((cur) => cur + 1);
        }
      };
      source.onmessage = (event) => {
        const parsed = parseSse(event.data);
        if (!parsed) return;
        lastEventIdRef.current = parsed.id;
        pending.push(parsed);
        if (!streamFrameRef.current) {
          streamFrameRef.current = requestAnimationFrame(flush);
        }
      };
      source.onerror = () => {
        if (source.readyState !== EventSource.CLOSED) return;
        window.setTimeout(() => {
          if (sourceRef.current === source) {
            listenRef.current(id, lastEventIdRef.current);
          }
        }, 750);
      };
      sourceRef.current = source;
    },
    [closeStream, refreshRuns],
  );
  listenRef.current = listen;

  const openRun = useCallback(
    async (id: string, opts?: { record?: boolean }) => {
      setRunId(id);
      setNav("chats");
      if (opts?.record !== false) {
        setTrail((cur) => {
          const clipped = cur.ids.slice(0, cur.at + 1);
          if (clipped.at(-1) === id) return { ids: clipped, at: clipped.length - 1 };
          const ids = [...clipped, id];
          return { ids, at: ids.length - 1 };
        });
      }
      const [runRes, transcriptRes, diffRes] = await Promise.all([
        api(tokenRef.current, `/v1/runs/${id}`),
        api(tokenRef.current, `/v1/runs/${id}/transcript?limit=80`),
        api(tokenRef.current, `/v1/runs/${id}/diff`),
      ]);
      if (!runRes.ok) return;
      const run = await readJson<Run>(runRes);
      setCurrent(run);
      setQueuedFollowUps([]);
      setChatToolsOpen(false);
      if (run.projectId) {
        const projectRes = await api(tokenRef.current, `/v1/projects/${run.projectId}`);
        if (projectRes.ok) {
          const project = await readJson<Project>(projectRes);
          setActiveProject(project);
        }
      } else {
        setActiveProject(null);
      }
      if (transcriptRes.ok) {
        const body = await readJson<{ snapshot?: TranscriptSnapshot }>(transcriptRes);
        const snapshot = body.snapshot;
        const loaded = snapshot?.messages ?? [];
        setMessages(isActiveRunStatus(run.status) ? loaded : settleTranscriptMessages(loaded));
        lastEventIdRef.current = snapshot?.lastEventId ?? null;
      } else {
        setMessages([]);
        lastEventIdRef.current = null;
      }
      if (run.executionTarget?.loop === "desk") {
        // The files live on this machine, so the control plane has nothing to diff.
        const localFolder = (await deskBridge()?.getTarget().catch(() => undefined))?.folder || run.repoUrls[0] || "";
        setDiff(localFolder ? ((await deskBridge()?.diffStat?.(localFolder).catch(() => null)) ?? null) : null);
      } else if (diffRes.ok) {
        setDiff(diffStats(await diffRes.text()));
      } else {
        setDiff(null);
      }
      listen(id, lastEventIdRef.current);
    },
    [listen],
  );

  const openRunRef = useRef(openRun);
  useEffect(() => {
    openRunRef.current = openRun;
  }, [openRun]);

  const finishLogin = useCallback(async () => {
    const me = await api(tokenRef.current, "/v1/me");
    if (!me.ok) throw new Error("unauthorized");
    const body = await readJson<{ user?: { id?: string; email?: string; username?: string } }>(me);
    setUser(body.user?.username || body.user?.email || "desk");
    setUserId(body.user?.id || "");
    setAuthed(true);
    const desk = deskBridge();
    if (desk) {
      await desk.setToken(tokenRef.current).catch(() => undefined);
      const saved = await desk.getTarget().catch(() => undefined);
      if (saved) {
        setTarget(saved);
        if (saved.folder) setFolder(saved.folder);
      }
    }
    await Promise.all([refreshRuns(), refreshAutomations(), refreshProjects(), refreshExperts(), refreshLlm(), refreshInbox()]);
  }, [refreshAutomations, refreshExperts, refreshInbox, refreshLlm, refreshProjects, refreshRuns]);

  useEffect(() => {
    if (!authed) return;
    const applyHash = () => {
      const hash = location.hash;
      const invite = inviteTokenFromHash(hash) ?? inviteTokenFromDeepLink(hash);
      if (invite) {
        setInviteToken(invite);
        setNav("projects");
        return;
      }
      const projectId = projectIdFromHash(hash);
      if (projectId) {
        void openProject(projectId);
        return;
      }
      const hashedRun = runIdFromHash(hash) ?? runIdFromDeepLink(hash);
      if (hashedRun) {
        void openRun(hashedRun);
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [authed, openProject, openRun]);

  useEffect(() => {
    void (async () => {
      const saved = (await deskBridge()?.getToken().catch(() => "")) || "";
      if (!saved) return;
      persist(saved);
      try {
        await finishLogin();
      } catch {
        persist("");
      }
    })();
    return () => {
      if (streamFrameRef.current) {
        cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = 0;
      }
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [finishLogin, persist]);

  const login = async () => {
    if (!email.trim() || !password) {
      setAuthError("请输入账号和密码");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await fetch(withApiBase("/v1/auth/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await readJson<{ token?: string; user?: { email?: string }; error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "登录失败");
      persist(body.token ?? "");
      await finishLogin();
    } catch (error) {
      persist("");
      setAuthError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setAuthBusy(false);
    }
  };

  const pickLocalFolder = useCallback(async () => {
    const bridge = deskBridge();
    if (!bridge) return;
    const picked = asWorkspaceRef(await bridge.pickFolder());
    if (!picked) return;
    setFolder(picked.folder);
    setWorkspaces((await bridge.listWorkspaces?.().catch(() => [])) ?? []);
    applyTargetRef.current({ kind: "desk", folder: picked.folder, workspaceId: picked.id || undefined });
  }, []);

  /** Bring a local run's worker back on this machine, in the same folder. */
  const resumeLocalRun = useCallback(async (id: string) => {
    const start = deskBridge()?.startRun;
    if (!start) {
      setAuthError(STALE_DESK_HINT);
      return;
    }
    const response = await api(tokenRef.current, `/v1/runs/${id}/desk-start`, { method: "POST" });
    const body = await readJson<{ assignment?: DeskAssignment; error?: string }>(response);
    if (!response.ok || !body.assignment) {
      setAuthError(body.error || "本机启动失败");
      return;
    }
    await start(body.assignment);
  }, []);

  const send = async (draft?: string, opts?: { asNew?: boolean; todo?: { id: string; title: string } | null }) => {
    const text = (draft ?? prompt).trim();
    if (!text || sending) return;
    const local = target.kind === "desk";
    if (local && !folder) {
      // Do not create a run that can never start. Ask for the folder first.
      setAuthError("先选一个本机文件夹，Agent 才知道该改哪里。");
      return;
    }
    const askPrefix = mode === "ask" ? "只阅读和回答，不要修改文件或执行会改状态的命令。\n\n" : "";
    const startNew = opts?.asNew || !runId;
    const boundTodo = opts && "todo" in opts ? opts.todo : pendingTodo;
    setSending(true);
    if (!draft) setPrompt("");
    try {
      if (startNew) {
        const created = await readJson<Run & { assignment?: DeskAssignment; error?: string }>(
          await api(token, "/v1/runs", {
            method: "POST",
            body: JSON.stringify({
              prompt: `${askPrefix}${boundTodo ? `待办：${boundTodo.title}\n\n` : ""}${text}`,
              model: selectedModel || undefined,
              source: "desk",
              projectId: activeProject?.id,
              todoId: boundTodo?.id,
              expertId: expertPick.expertId,
              expertTeamId: expertPick.expertTeamId,
              // This window is the desk, so it starts the worker itself instead
              // of waiting to be handed its own run back.
              start: local ? "inline" : undefined,
              deskWorkspaceId: local ? target.workspaceId : undefined,
              repoUrls:
                local && folder
                  ? [folder]
                  : composerRepo
                    ? [composerRepo]
                    : activeProject?.defaultRepoUrls?.length
                      ? activeProject.defaultRepoUrls
                      : [],
              target: local
                ? { loop: "desk", tools: "desk", deskId: target.deskId, deskWorkspaceId: target.workspaceId }
                : { loop: "cloud", tools: "cloud" },
            }),
          }),
        );
        if (created.error) throw new Error(created.error);
        setPendingTodo(null);
        setRuns((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        if (created.assignment) {
          const start = deskBridge()?.startRun;
          if (start) {
            await start(created.assignment);
          } else {
            setAuthError(STALE_DESK_HINT);
          }
        }
        await openRun(created.id);
        return;
      }
      await api(token, `/v1/runs/${runId}/follow-ups`, {
        method: "POST",
        body: JSON.stringify({ text: `${askPrefix}${text}` }),
      });
      setQueueEpoch((cur) => cur + 1);
      if (current?.executionTarget?.loop === "desk" && localStatus?.state !== "running") {
        await resumeLocalRun(runId);
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  const applyTarget = useCallback((next: DeskTarget) => {
    setTarget(next);
    void deskBridge()?.setTarget(next);
  }, []);

  const applyTargetRef = useRef(applyTarget);
  useEffect(() => {
    applyTargetRef.current = applyTarget;
  }, [applyTarget]);

  useEffect(() => {
    localStorage.setItem("neo.desk.panel", panelOpen ? "1" : "0");
    localStorage.setItem("neo.desk.panelTab", panelTab);
  }, [panelOpen, panelTab]);

  // Surface what the main process is doing with local runs, instead of leaving
  // failures in a terminal the user never sees.
  useEffect(() => {
    const bridge = deskBridge();
    if (!bridge?.onRunStatus) return;
    const offStatus = bridge.onRunStatus((status) => {
      setLocalStatus(status);
      if (status.state === "failed" && status.detail) {
        setAuthError(status.detail);
      }
      if (status.state === "running" || status.state === "stopped") {
        setPanelEpoch((n) => n + 1);
        void refreshRuns();
      }
    });
    const offDispatch = bridge.onDispatched?.(({ runId: id }) => {
      void refreshRuns();
      void openRunRef.current(id);
    });
    const offTarget = bridge.onTarget?.((saved) => {
      setTarget(saved);
      if (saved.folder) setFolder(saved.folder);
      void bridge.listWorkspaces?.().then(setWorkspaces).catch(() => undefined);
    });
    return () => {
      offStatus?.();
      offDispatch?.();
      offTarget?.();
    };
  }, [refreshRuns]);

  useEffect(() => {
    const bridge = deskBridge();
    if (!bridge || !authed) return;
    void bridge.listWorkspaces?.().then(setWorkspaces).catch(() => undefined);
    void bridge
      .getPrefs?.()
      .then((value) => setRequireApproval(value.requireApproval === true))
      .catch(() => undefined);
  }, [authed, folder]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setModelMenu(false);
        setContextOpen(null);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
        if (!runId) return;
        event.preventDefault();
        setRunId(null);
        setCurrent(null);
        setMessages([]);
        closeStream();
        if (activeProject) {
          setNav("projects");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeProject, closeStream, runId]);

  useEffect(() => {
    if (!authed) return;
    const onShow = () => {
      if (document.visibilityState === "hidden") return;
      void refreshRuns();
      void refreshInbox();
    };
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    const timer = window.setInterval(() => void refreshInbox(), 20_000);
    return () => {
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", onShow);
      window.clearInterval(timer);
    };
  }, [authed, refreshInbox, refreshRuns]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages, runId]);

  const queuedFollowUpIds = useMemo(
    () => queuedFollowUps.filter((item) => item.status === "queued").map((item) => item.id),
    [queuedFollowUps],
  );
  const onQueuedChange = useCallback((items: FollowUp[]) => {
    setQueuedFollowUps((cur) => {
      if (
        cur.length === items.length &&
        cur.every((item, index) => item.id === items[index]?.id && item.status === items[index]?.status && item.text === items[index]?.text)
      ) {
        return cur;
      }
      return items;
    });
  }, []);
  useEffect(() => {
    if (!authed || !current || current.projectId) return;
    let cancelled = false;
    void api(token, `/v1/runs/${current.id}/follow-ups`).then(async (response) => {
      if (!response.ok || cancelled) return;
      const body = await readJson<{ followUps?: FollowUp[] }>(response);
      onQueuedChange((body.followUps ?? []).filter((item) => item.status === "queued"));
    });
    return () => {
      cancelled = true;
    };
  }, [authed, current, onQueuedChange, queueEpoch, token]);

  const visible = displayTranscriptMessages(messages, { hideFollowUpIds: queuedFollowUpIds });
  const activity = liveActivityLabel(visible);
  const rail = useMemo(() => {
    const names = new Map(projects.map((item) => [item.id, item.name]));
    return groupRailSessions(runs, (id) => names.get(id));
  }, [projects, runs]);

  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs
      .filter((run) => {
        if (!q) return true;
        const repo = repoLabel(run.repoUrls[0]).toLowerCase();
        const projectName = projects.find((item) => item.id === run.projectId)?.name.toLowerCase() ?? "";
        return (
          run.prompt.toLowerCase().includes(q) ||
          run.id.toLowerCase().includes(q) ||
          repo.includes(q) ||
          (run.branchName ?? "").toLowerCase().includes(q) ||
          run.status.toLowerCase().includes(q) ||
          projectName.includes(q)
        );
      })
      .slice(0, 12)
      .map((run) => ({
        id: run.id,
        title: preview(run.prompt, 72),
        meta: runSearchMeta(run, repoLabel(run.repoUrls[0]), isCloudRun(run), formatRel(run.updatedAt)),
      }));
  }, [projects, query, runs]);

  const projectHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects
      .filter((item) => !q || item.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((item) => ({ id: item.id, title: item.name, meta: "项目工作台" }));
  }, [projects, query]);

  const visibleTodoHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return todoHits.filter((item) => !q || item.title.toLowerCase().includes(q) || item.meta.toLowerCase().includes(q)).slice(0, 12);
  }, [query, todoHits]);

  useEffect(() => {
    if (!authed) {
      setMentions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      if (current && !current.projectId) {
        const artifactRes = await api(tokenRef.current, `/v1/runs/${current.id}/artifacts`);
        if (cancelled) return;
        const artifacts = artifactRes.ok
          ? ((await readJson<{ artifacts?: Array<{ name: string }> }>(artifactRes)).artifacts ?? [])
          : [];
        setMentions([
          ...artifacts.map((item) => ({
            kind: "file" as const,
            id: item.name,
            label: item.name,
            insert: `@文件 ${item.name}`,
          })),
          ...automations.map((item) => ({
            kind: "command" as const,
            id: item.id,
            label: item.name,
            insert: `/自动化 ${item.name}`,
          })),
          ...experts.map((item) => ({
            kind: "expert" as const,
            id: item.id,
            label: item.name,
            insert: `@专家 ${item.name}`,
          })),
          ...teams.map((item) => ({
            kind: "team" as const,
            id: item.id,
            label: item.name,
            insert: `@专家团 ${item.name}`,
          })),
        ]);
        return;
      }
      if (!activeProject || current?.projectId !== activeProject.id) {
        setMentions([
          ...automations.map((item) => ({
            kind: "command" as const,
            id: item.id,
            label: item.name,
            insert: `/自动化 ${item.name}`,
          })),
          ...experts.map((item) => ({
            kind: "expert" as const,
            id: item.id,
            label: item.name,
            insert: `@专家 ${item.name}`,
          })),
          ...teams.map((item) => ({
            kind: "team" as const,
            id: item.id,
            label: item.name,
            insert: `@专家团 ${item.name}`,
          })),
        ]);
        return;
      }
      const [todoRes, assetRes] = await Promise.all([
        api(tokenRef.current, `/v1/projects/${activeProject.id}/todos`),
        api(tokenRef.current, `/v1/projects/${activeProject.id}/assets`),
      ]);
      if (cancelled) return;
      const todos = todoRes.ok
        ? ((await readJson<{ todos?: Array<{ id: string; title: string }> }>(todoRes)).todos ?? [])
        : [];
      const assets = assetRes.ok
        ? ((await readJson<{ assets?: Array<{ id: string; path: string }> }>(assetRes)).assets ?? [])
        : [];
      setMentions([
        ...todos.map((item) => ({
          kind: "todo" as const,
          id: item.id,
          label: item.title,
          insert: `@待办 ${item.title}`,
        })),
        ...assets.map((item) => ({
          kind: "asset" as const,
          id: item.id,
          label: item.path,
          insert: `@资产 ${item.path}`,
        })),
        ...experts.map((item) => ({
          kind: "expert" as const,
          id: item.id,
          label: item.name,
          insert: `@专家 ${item.name}`,
        })),
        ...teams.map((item) => ({
          kind: "team" as const,
          id: item.id,
          label: item.name,
          insert: `@专家团 ${item.name}`,
        })),
      ]);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProject, authed, automations, current, experts, teams]);

  useEffect(() => {
    if (!searchOpen || !authed) return;
    void (async () => {
      const rows = await Promise.all(
        projects.slice(0, 12).map(async (project) => {
          const response = await api(tokenRef.current, `/v1/projects/${project.id}/todos`);
          if (!response.ok) return [];
          const body = await readJson<{ todos?: Array<{ id: string; title: string; status: string }> }>(response);
          return (body.todos ?? []).map((todo) => ({
            id: todo.id,
            title: todo.title,
            meta: `${project.name} · ${todo.status}`,
            projectId: project.id,
          }));
        }),
      );
      setTodoHits(rows.flat());
    })();
  }, [authed, projects, searchOpen]);

  useEffect(() => {
    setRepoOpen((cur) => {
      const next = { ...cur };
      for (const space of rail.spaces) {
        if (next[space.key] === undefined) next[space.key] = true;
      }
      return next;
    });
  }, [rail]);

  const newChat = () => {
    setRunId(null);
    setCurrent(null);
    setMessages([]);
    setDiff(null);
    setSearchOpen(false);
    setModelMenu(false);
    setContextOpen(null);
    setNav("chats");
    lastEventIdRef.current = null;
    closeStream();
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const title = current ? preview(current.prompt, 42) : "New Agent";

  const createProject = async () => {
    if (!projectName.trim() || projectBusy) return;
    setProjectBusy(true);
    setAuthError("");
    try {
      const response = await api(token, "/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          name: projectName.trim(),
          instruction: projectInstruction,
          invitePolicy: "approve",
        }),
      });
      const body = await readJson<Project & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "创建失败");
      setProjectName("");
      setProjectInstruction("");
      await refreshProjects();
      setActiveProject(body);
      setWorkbenchTab("board");
      setInviteToken(null);
      setNav("projects");
      setProjectModal(false);
      location.hash = hashForProject(body.id);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "创建失败");
    } finally {
      setProjectBusy(false);
    }
  };

  const createAutomation = async () => {
    if (!autoPrompt.trim() || autoBusy) return;
    setAutoBusy(true);
    setAuthError("");
    try {
      const schedule = SCHEDULE_PRESETS.find((item) => item.id === autoPreset)?.schedule;
      const response = await api(token, "/v1/automations", {
        method: "POST",
        body: JSON.stringify({ prompt: autoPrompt.trim(), schedule }),
      });
      const body = await readJson<Automation & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "创建失败");
      setAutoPrompt("");
      setAutoModal(false);
      await refreshAutomations();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "创建失败");
    } finally {
      setAutoBusy(false);
    }
  };

  const toggleAutomation = async (item: Automation) => {
    await api(token, `/v1/automations/${item.id}`, {
      method: "POST",
      body: JSON.stringify({ enabled: !item.enabled }),
    });
    await refreshAutomations();
  };

  const saveModel = async () => {
    if (!modelName.trim() || modelBusy) return;
    const newApiManaged = Boolean(llm.newApi?.consoleUrl || llm.newApi?.url);
    if (!newApiManaged && !llm.configured && !modelKey.trim()) return;
    setModelBusy(true);
    setAuthError("");
    try {
      const response = await api(token, "/v1/settings/llm", {
        method: "POST",
        body: JSON.stringify(
          newApiManaged
            ? { upstream: "deepseek", model: modelName.trim() }
            : {
                upstream: "openai",
                model: modelName.trim(),
                baseUrl: (modelBaseUrl.trim() || OPENAI_BASE_URL).replace(/\/$/, ""),
                ...(modelKey.trim() ? { apiKey: modelKey.trim() } : {}),
              },
        ),
      });
      const body = await readJson<PublicLlmSettings & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "保存失败");
      setModelKey("");
      setSavedModels(
        rememberSavedModel({
          name: modelName.trim(),
          baseUrl: (modelBaseUrl.trim() || OPENAI_BASE_URL).replace(/\/$/, ""),
        }),
      );
      setSelectedModel(modelName.trim());
      await refreshLlm();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setModelBusy(false);
    }
  };

  const openSettings = () => {
    setSearchOpen(false);
    setModelMenu(false);
    setNav("settings");
  };

  const modelNames = useMemo(() => {
    const names = [llm.model, selectedModel, ...savedModels.map((item) => item.name)].filter(
      (item): item is string => Boolean(item),
    );
    return [...new Set(names)];
  }, [llm.model, savedModels, selectedModel]);

  const repoChoices = useMemo(() => {
    const map = new Map<string, string>();
    map.set("", "不关联仓库");
    for (const run of runs) {
      const url = run.repoUrls[0] || "";
      // Local runs carry a path; those show up under 这台电脑 instead.
      if (url && !isLocalPathLike(url)) map.set(url, repoPath(url));
    }
    for (const url of activeProject?.defaultRepoUrls ?? []) {
      if (url) map.set(url, repoPath(url));
    }
    return [...map.entries()].map(([url, label]) => ({ url, label }));
  }, [activeProject, runs]);

  const contextRepoUrl = current?.repoUrls[0] || composerRepo;
  const contextRepoName = current
    ? repoPath(current.repoUrls[0])
    : composerRepo
      ? repoPath(composerRepo)
      : "选择仓库";

  const branch = current?.branchName || "";

  // An open local run keeps its own folder; with no run open, follow the picker.
  const localRunActive = current?.executionTarget?.loop === "desk";
  const panelIsLocal = current ? localRunActive : target.kind === "desk";
  const localFolder = panelIsLocal
    ? (localRunActive && current?.repoUrls[0] && path0(current.repoUrls[0]).startsWith("/")
        ? current.repoUrls[0]
        : folder)
    : "";

  const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setAuthError("复制失败");
    }
  };

  if (!authed) {
    return (
      <div className="login-shell">
        <form
          className="login-card"
          onSubmit={(event) => {
            event.preventDefault();
            void login();
          }}
        >
          <p className="login-kicker">Neo Desk</p>
          <h1>Sign in</h1>
          <p>表单故意留空。默认账号是 admin / 123456，和 Web 同一控制面。</p>
          <label>
            Username
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {authError ? <p className="error">{authError}</p> : null}
          <button type="submit" disabled={authBusy}>
            {authBusy ? "Signing in…" : "Continue"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="agents-app" data-nav={nav}>
      <aside className="rail">
        <div className="rail-history">
          <button
            type="button"
            className="icon-btn"
            aria-label="Back"
            disabled={trail.at <= 0}
            onClick={() => {
              const at = trail.at - 1;
              const id = trail.ids[at];
              if (!id) return;
              setTrail((cur) => ({ ...cur, at }));
              void openRun(id, { record: false });
            }}
          >
            <IconBack />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Forward"
            disabled={trail.at < 0 || trail.at >= trail.ids.length - 1}
            onClick={() => {
              const at = trail.at + 1;
              const id = trail.ids[at];
              if (!id) return;
              setTrail((cur) => ({ ...cur, at }));
              void openRun(id, { record: false });
            }}
          >
            <IconForward />
          </button>
        </div>

        <nav className="rail-nav">
          <button type="button" className={`rail-item${nav === "chats" ? " on" : ""}`} onClick={newChat}>
            <span className="rail-icon">
              <IconNewChat />
            </span>
            New Chat
          </button>
          <button
            type="button"
            className="rail-item"
            aria-expanded={searchOpen}
            aria-haspopup="dialog"
            onClick={() => {
              if (searchOpen) {
                setSearchOpen(false);
                return;
              }
              setSearchOpen(true);
              setSearchFilter("all");
              void refreshRuns();
              requestAnimationFrame(() => searchRef.current?.focus());
            }}
          >
            <span className="rail-icon">
              <IconSearch />
            </span>
            Search
          </button>
          <button
            type="button"
            className={`rail-item${nav === "automations" ? " on" : ""}`}
            onClick={() => {
              setSearchOpen(false);
              setNav("automations");
            }}
          >
            <span className="rail-icon">
              <IconAutomations />
            </span>
            Automations
          </button>
          <button
            type="button"
            className={`rail-item${nav === "projects" ? " on" : ""}`}
            onClick={() => {
              setSearchOpen(false);
              setInviteToken(null);
              setNav("projects");
            }}
          >
            <span className="rail-icon">
              <IconProjects />
            </span>
            Projects
          </button>
          <button
            type="button"
            className={`rail-item${nav === "experts" ? " on" : ""}`}
            onClick={() => {
              setSearchOpen(false);
              setNav("experts");
              void refreshExperts(activeProject?.id);
            }}
          >
            <span className="rail-icon">
              <IconExperts />
            </span>
            Experts
          </button>
        </nav>

        <div className="repo-head">
          <span>会话</span>
          <div className="repo-head-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label="Search agents"
              onClick={() => {
                setSearchOpen(true);
                requestAnimationFrame(() => searchRef.current?.focus());
              }}
            >
              <IconSort />
            </button>
          </div>
        </div>

        <div className="repo-tree">
          <RailSessions
            inbox={rail.inbox}
            spaces={rail.spaces}
            runId={runId}
            inboxOpen={railInboxOpen}
            spacesOpen={railSpacesOpen}
            inboxExpanded={railInboxExpanded}
            folderOpen={repoOpen}
            formatRel={formatRel}
            onToggleInbox={() => setRailInboxOpen((cur) => !cur)}
            onToggleSpaces={() => setRailSpacesOpen((cur) => !cur)}
            onToggleInboxExpanded={() => setRailInboxExpanded((cur) => !cur)}
            onToggleFolder={(key) => setRepoOpen((cur) => ({ ...cur, [key]: cur[key] === false }))}
            onOpenRun={(id) => void openRun(id)}
          />
        </div>

        <div className="rail-foot">
          <div className="profile">
            <button
              type="button"
              className="avatar inbox-avatar"
              aria-label="收件箱"
              onClick={() => {
                setInboxOpen((cur) => !cur);
                void refreshInbox();
              }}
            >
              {initials(user)}
              {inboxItems.some((item) => !item.read) ? <i className="inbox-dot" /> : null}
            </button>
            <span className="profile-name">{user}</span>
            {remoteApiHost ? <span className="prod-tag">生产</span> : null}
            <button type="button" className="icon-btn" aria-label="Settings" onClick={openSettings}>
              <IconGear />
            </button>
          </div>
          {inboxOpen ? (
            <div className="inbox-pop">
              <p className="palette-label">收件箱</p>
              {inboxItems.length === 0 ? (
                <p className="hint">没有通知。</p>
              ) : (
                inboxItems.slice(0, 12).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`palette-row${item.read ? "" : " unread"}`}
                    onClick={() => {
                      void api(token, `/v1/inbox/${item.id}/read`, { method: "POST" }).then(() => refreshInbox());
                      setInboxOpen(false);
                      if (item.runId) void openRun(item.runId);
                      else if (item.projectId) void openProject(item.projectId, workbenchTabForInbox(item.kind));
                    }}
                  >
                    <strong>{item.title}</strong>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </aside>

      <main className="stage">
        <button
          type="button"
          className={`panel-toggle${panelOpen ? " on" : ""}`}
          aria-label={panelOpen ? "收起右侧栏" : "打开右侧栏"}
          title={panelOpen ? "收起右侧栏" : "Files / Terminal"}
          onClick={() => setPanelOpen((cur) => !cur)}
        >
          <IconPanelRight size={15} />
        </button>
        <div className="stage-col" key={nav}>
        {nav === "automations" ? (
          <AutomationsPage
            items={automations}
            onCreate={() => {
              setAuthError("");
              setAutoModal(true);
            }}
            onToggle={(item) => void toggleAutomation(item)}
            onOpenRun={(id) => void openRun(id)}
          />
        ) : nav === "experts" ? (
          <ExpertsPage
            token={token}
            userId={userId}
            projectId={activeProject?.id}
            onSummon={(pick) => {
              setExpertPick({ expertId: pick.expertId, expertTeamId: pick.expertTeamId });
              setRunId(null);
              setCurrent(null);
              setMessages([]);
              closeStream();
              setNav("chats");
            }}
          />
        ) : nav === "projects" ? (
          inviteToken ? (
            <InviteAcceptPage
              token={token}
              inviteToken={inviteToken}
              onJoined={(project) => {
                setProjects((cur) => [project, ...cur.filter((item) => item.id !== project.id)]);
                void openProject(project.id);
              }}
            />
          ) : activeProject ? (
            <ProjectWorkbench
              project={activeProject}
              runs={runs}
              token={token}
              userId={userId}
              initialTab={workbenchTab}
              onBack={() => {
                setActiveProject(null);
                setWorkbenchTab("board");
                location.hash = "";
              }}
              composing={sending}
              targetKind={target.kind}
              onStartChat={(todo) => {
                setPendingTodo(todo ?? null);
                void newChat();
              }}
              onCompose={(text) => void send(text, { asNew: true, todo: null })}
              onOpenRun={(id) => void openRun(id)}
              onProjectChange={(project) => {
                setActiveProject(project);
                setProjects((cur) => cur.map((item) => (item.id === project.id ? project : item)));
              }}
            />
          ) : (
            <ProjectsPage
              items={projects}
              query={projectQuery}
              setQuery={setProjectQuery}
              activeId={null}
              onCreate={() => {
                setAuthError("");
                setProjectName("");
                setProjectInstruction("");
                setProjectModal(true);
              }}
              onSelect={(item) => {
                if (item) void openProject(item.id);
                else setActiveProject(null);
              }}
            />
          )
        ) : nav === "settings" ? (
          <ModelSettingsPage
            name={modelName}
            setName={setModelName}
            apiKey={modelKey}
            setApiKey={setModelKey}
            baseUrl={modelBaseUrl}
            setBaseUrl={setModelBaseUrl}
            configured={llm.configured}
            busy={modelBusy}
            error={authError || undefined}
            newApi={llm.newApi}
            onSave={() => void saveModel()}
          >
            <div className="settings-card">
              <h2>This computer</h2>
              <label>
                <span>Target</span>
                <Select
                  value={target.kind}
                  onValueChange={(value) => applyTarget({ ...target, kind: value as DeskTarget["kind"] })}
                  options={[
                    { value: "cloud", label: "Cloud" },
                    {
                      value: "desk",
                      label: canRunLocal ? "This Computer" : "This Computer (needs Electron)",
                      disabled: !canRunLocal,
                    },
                    { value: "remote", label: "Remote SSH", disabled: true },
                  ]}
                />
              </label>
              <button type="button" className="folder-btn" onClick={() => void pickLocalFolder()}>
                {folder || "选择本机文件夹…"}
              </button>
              <p className="hint">
                Agent 会直接改这个文件夹里的文件，包括还没提交的改动。写不出这个文件夹。
              </p>
              {workspaces.length > 0 ? (
                <ul className="ws-list">
                  {workspaces.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`ws-pick${path0(folder) === path0(item.folder) ? " on" : ""}`}
                        onClick={() => {
                          setFolder(item.folder);
                          applyTarget({ ...target, kind: "desk", folder: item.folder, workspaceId: item.id });
                        }}
                      >
                        {item.name}
                        {item.git ? "" : "（不是 git 仓库）"}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          void deskBridge()
                            ?.unbindWorkspace?.(item.id)
                            .then(() => deskBridge()?.listWorkspaces?.())
                            .then((next) => setWorkspaces(next ?? []));
                          if (path0(folder) === path0(item.folder)) {
                            setFolder("");
                            applyTarget({ ...target, folder: undefined, workspaceId: undefined });
                          }
                        }}
                      >
                        解绑
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <label className="ws-toggle">
                <input
                  type="checkbox"
                  checked={requireApproval}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setRequireApproval(next);
                    void deskBridge()?.setPrefs?.({ requireApproval: next });
                  }}
                />
                <span>远程派来的对话，每次都先问我</span>
              </label>
              <p className="hint">
                绑定文件夹就等于允许远程在里面开对话。打开这个开关会改成每条都先弹确认。
              </p>
            </div>
          </ModelSettingsPage>
        ) : (
          <section
            className={`page chat-page${current?.projectId ? " project-chat" : current ? " personal-chat" : ""}${
              panelOpen ? " with-panel" : ""
            }`}
          >
            <div className="chat-stage">
            {localRunActive ? (
              <div className="local-bar">
                <IconComputer size={13} />
                <span>This Computer · {folderName(localFolder)}</span>
                {localStatus?.state === "starting" ? <em>正在启动…</em> : null}
                {localStatus?.state === "running" ? <em className="ok">已在这台电脑上运行</em> : null}
                {localStatus?.state === "failed" ? <em className="bad">{localStatus.detail || "启动失败"}</em> : null}
                {localStatus?.state === "stopped" || !localStatus ? (
                  <button type="button" className="ghost" onClick={() => current && void resumeLocalRun(current.id)}>
                    在这台电脑上继续
                  </button>
                ) : null}
                {localStatus?.state === "running" ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => current && void deskBridge()?.stopRun?.(current.id)}
                  >
                    停止本机 worker
                  </button>
                ) : null}
              </div>
            ) : null}
            {current?.projectId ? (
              <ProjectChatPage
                title={title}
                project={activeProject?.id === current.projectId ? activeProject : null}
                current={current}
                token={token}
                userId={userId}
                user={user}
                toolsOpen={chatToolsOpen}
                visible={visible}
                activity={activity}
                feedRef={feedRef}
                onOpenProject={() => void openProject(current.projectId!)}
                onSearch={() => {
                  setSearchOpen(true);
                  setSearchFilter("all");
                  requestAnimationFrame(() => searchRef.current?.focus());
                }}
                onRefresh={() => void openRun(current.id, { record: false })}
                onToggleTools={() => setChatToolsOpen((cur) => !cur)}
                onRunChange={(next) => {
                  setCurrent(next);
                  setRuns((prev) => [next, ...prev.filter((item) => item.id !== next.id)]);
                }}
                onAbort={() => {
                  void api(token, `/v1/runs/${current.id}/abort`, { method: "POST" });
                }}
                onTransferred={(next) => {
                  setCurrent(next);
                  setRuns((prev) => [next, ...prev.filter((item) => item.id !== next.id && item.id !== current.id)]);
                  if (next.id !== current.id) {
                    void openRun(next.id);
                  }
                }}
                onCopy={(text) => void copyText(text)}
                queueEpoch={queueEpoch}
                onQueuedChange={onQueuedChange}
              />
            ) : current ? (
              <PersonalChatPage
                title={title}
                current={current}
                visible={visible}
                activity={activity}
                user={user}
                feedRef={feedRef}
                onSearch={() => {
                  setSearchOpen(true);
                  setSearchFilter("all");
                  requestAnimationFrame(() => searchRef.current?.focus());
                }}
                onRefresh={() => void openRun(current.id, { record: false })}
                onCopy={(text) => void copyText(text)}
                onAbort={() => {
                  void api(token, `/v1/runs/${current.id}/abort`, { method: "POST" });
                }}
              />
            ) : null}

            <footer className={`composer-wrap${current ? "" : " home-wrap"}`}>
              {current ? null : (
                <ContextBar
                  repoLabel={contextRepoName}
                  repos={repoChoices}
                  repoUrl={contextRepoUrl}
                  onRepo={(url) => {
                    setComposerRepo(url);
                    applyTarget({ ...target, kind: "cloud" });
                  }}
                  workspaces={workspaces}
                  folder={folder}
                  onWorkspace={(picked) => {
                    setFolder(picked.folder);
                    applyTarget({ kind: "desk", folder: picked.folder, workspaceId: picked.id, deskId: target.deskId });
                  }}
                  onPickFolder={() => void pickLocalFolder()}
                  branch={branch || "main"}
                  targetKind={target.kind}
                  canRunLocal={canRunLocal}
                  onTarget={(kind) => applyTarget({ ...target, kind, folder: kind === "desk" ? folder : target.folder })}
                  open={contextOpen}
                  setOpen={setContextOpen}
                  locked={false}
                />
              )}
              {current && diff && (diff.added > 0 || diff.removed > 0) ? (
                <div className="chips">
                  <button type="button" className="chip">
                    Changes <em className="add">+{diff.added}</em> <em className="del">-{diff.removed}</em>
                  </button>
                </div>
              ) : null}
              <ChatComposer
                prompt={prompt}
                setPrompt={setPrompt}
                placeholder={
                  current?.projectId
                    ? "今天帮你做些什么？@ 引用资产文件或项目待办"
                    : current
                      ? "今天帮你做些什么？@ 引用对话文件，/ 调用已有自动化"
                      : "今天帮你做些什么？"
                }
                sending={sending}
                models={modelNames}
                selected={selectedModel}
                menuOpen={modelMenu}
                setMenuOpen={(next) => {
                  setModelMenu(next);
                  if (next) setContextOpen(null);
                }}
                onSelectModel={(name) => {
                  setSelectedModel(name);
                  setModelMenu(false);
                }}
                onAddModel={openSettings}
                onSubmit={() => void send()}
                taRef={taRef}
                onComposerKey={onComposerKey}
                home={!current}
                mentions={mentions}
                experts={experts}
                teams={teams}
                expertValue={
                  current
                    ? encodeExpertPick({
                        expertId: current.expertId ?? undefined,
                        expertTeamId: current.expertTeamId ?? undefined,
                      })
                    : encodeExpertPick(expertPick)
                }
                expertLocked={Boolean(current)}
                onExpert={(value) => setExpertPick(decodeExpertPick(value))}
                onMention={(item) => {
                  if (item.kind === "expert") setExpertPick({ expertId: item.id });
                  if (item.kind === "team") setExpertPick({ expertTeamId: item.id });
                }}
                queued={queuedFollowUps}
                waiting={Boolean(current && (queuedFollowUps.length > 0 || current.status === "RUNNING"))}
                onStop={
                  current
                    ? () => {
                        void api(token, `/v1/runs/${current.id}/abort`, { method: "POST" });
                      }
                    : undefined
                }
              />
              {current ? (
                <p className="composer-note">
                  {current.projectId ? "内容由模型生成，请核实重要信息" : "内容由 AI 生成，请核实重要信息"}
                </p>
              ) : null}
              {authError ? <p className="error toast-inline">{authError}</p> : null}
              {copied ? <p className="copied">Copied</p> : null}
            </footer>
            </div>
            {panelOpen ? (
              <SidePanel
                tab={panelTab}
                onTab={setPanelTab}
                onClose={() => setPanelOpen(false)}
                folder={localFolder}
                token={token}
                runId={runId}
                local={panelIsLocal}
                refreshKey={panelEpoch}
              />
            ) : null}
          </section>
        )}
        </div>
        {searchOpen ? (
          <SearchPalette
            query={query}
            setQuery={setQuery}
            filter={searchFilter}
            setFilter={setSearchFilter}
            hits={searchHits}
            projectHits={projectHits}
            todoHits={visibleTodoHits}
            searchRef={searchRef}
            onOpenRun={(id) => {
              setSearchOpen(false);
              void openRun(id);
            }}
            onOpenProject={(id) => {
              setSearchOpen(false);
              void openProject(id);
            }}
            onOpenTodo={(projectId) => {
              setSearchOpen(false);
              void openProject(projectId, "board");
            }}
            onOpenSettings={openSettings}
            onClose={() => setSearchOpen(false)}
          />
        ) : null}
      </main>
      {projectModal
        ? createPortal(
            <Modal title="新建项目" onClose={() => setProjectModal(false)}>
              <ProjectCreateForm
                name={projectName}
                setName={setProjectName}
                instruction={projectInstruction}
                setInstruction={setProjectInstruction}
                busy={projectBusy}
                error={authError || undefined}
                onCancel={() => setProjectModal(false)}
                onSubmit={() => void createProject()}
              />
            </Modal>,
            document.body,
          )
        : null}
      {autoModal
        ? createPortal(
            <Modal title="新建任务" onClose={() => setAutoModal(false)}>
              <AutomationCreateForm
                prompt={autoPrompt}
                setPrompt={setAutoPrompt}
                preset={autoPreset}
                setPreset={setAutoPreset}
                busy={autoBusy}
                error={authError || undefined}
                onCancel={() => setAutoModal(false)}
                onSubmit={() => void createAutomation()}
              />
            </Modal>,
            document.body,
          )
        : null}
    </div>
  );
}

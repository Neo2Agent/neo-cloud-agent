import type { PublicLlmSettings } from "@neo-cloud-agent/contracts";
import { decodeExpertPick, encodeExpertPick, type Expert, type ExpertPick, type ExpertTeam } from "@neo-cloud-agent/contracts/expert";
import type { Automation } from "@neo-cloud-agent/contracts/automation";
import type { RunEvent, TranscriptMessage, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { ExecutionTarget, Run } from "@neo-cloud-agent/contracts/run";
import { applyRunEventsToMessages, displayTranscriptMessages, settleTranscriptMessages } from "@neo-cloud-agent/contracts/transcript";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Tooltip } from "@neo-cloud-agent/ui";
import { createPortal } from "react-dom";
import { api, persistSessionToken, readJson } from "./api";
import {
  asWorkspaceRef,
  deskBridge,
  isLocalDeskKind,
  localRunFolder,
  localRunLabel,
  localRunTarget,
  mergeDeskTarget,
  DESK_CLIENT_QUERY,
  TARGET_CLOUD,
  TARGET_DESK,
  TARGET_REMOTE,
  MISSING_DESK_ID_HINT,
  STALE_DESK_HINT,
  withApiBase,
  type DeskRunStatus,
  type DeskTarget,
  type DeskWorkspaceRef,
} from "./desk";
import type { DeskAssignment } from "@neo-cloud-agent/contracts/desk";
import { DEFAULT_MAX_LOCAL_RUNS, normalizeMaxLocalRuns } from "../src/admission";
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
import { localRunView, otherRunningLocalRuns, runningLocalRunIds } from "./chat/local-run-view";
import { RailSessions } from "./chat/RailSessions";
import { initials } from "./project/helpers";
import { InviteAcceptPage } from "./project/InviteAcceptPage";
import { ProjectChatPage } from "./project/ProjectChatPage";
import { ProjectWorkbench } from "./project/ProjectWorkbench";
import type { WorkbenchTab } from "./project/types";
import {
  batchTurnSignal,
  isActiveRunStatus,
  liveActivityLabel,
  parseSse,
  appendPendingUser,
  dropResolvedPendingUsers,
  mergeUnresolvedPending,
  pendingUserArrived,
  runEventsQuery,
  statusFromEventKind,
  withPendingUser,
  type PendingUser,
} from "../src/stream";
import {
  AutomationCreateForm,
  AutomationsPage,
  ChatComposer,
  ContextBar,
  type ComposerMention,
  loadSavedModels,
  Modal,
  OPENAI_BASE_URL,
  SettingsPage,
  type SettingsSection,
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

/**
 * The rail and the search list need a timestamp that fits next to a title, so
 * this is the compact form. The project pages use `formatRel` from
 * `project/helpers`, which spells the same interval out in full.
 */
function formatRelShort(iso?: string | null): string {
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

const TURN_IDLE_GRACE_MS = 600;

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
  const [pendingTurn, setPendingTurn] = useState<PendingUser | null>(null);
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
  const [modelError, setModelError] = useState("");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("basics");
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
  // Keyed by runId: several local conversations can hold a worker at once, and a
  // single slot would show whichever one reported last.
  const [localStatuses, setLocalStatuses] = useState<Record<string, DeskRunStatus>>({});
  const [workspaces, setWorkspaces] = useState<DeskWorkspaceRef[]>([]);
  const [maxLocalRuns, setMaxLocalRuns] = useState(DEFAULT_MAX_LOCAL_RUNS);
  /** Said once when a new run joins a folder someone else is already editing. */
  const [localNotice, setLocalNotice] = useState("");
  const [copied, setCopied] = useState("");
  const [trail, setTrail] = useState<{ ids: string[]; at: number }>({ ids: [], at: -1 });
  const deskIdRef = useRef("");
  const tokenRef = useRef("");
  const sourceRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const streamFrameRef = useRef(0);
  const idleTimerRef = useRef(0);
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
    const next = body.runs ?? [];
    setRuns(next);
    setCurrent((cur) => {
      if (!cur) return cur;
      const fresh = next.find((item) => item.id === cur.id);
      if (!fresh || fresh.status === cur.status) return cur;
      return { ...cur, status: fresh.status };
    });
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
    runIdRef.current = null;
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
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = 0;
    }
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const listen = useCallback(
    (id: string, after?: string | null) => {
      closeStream();
      const cursor = after ?? lastEventIdRef.current;
      const query = runEventsQuery({ after: cursor, accessToken: tokenRef.current, client: DESK_CLIENT_QUERY });
      const source = new EventSource(withApiBase(`/v1/runs/${id}/events${query}`));
      const pending: RunEvent[] = [];
      const flush = () => {
        streamFrameRef.current = 0;
        if (sourceRef.current !== source) return;
        const batch = pending.splice(0);
        if (batch.length === 0) return;
        const signal = batchTurnSignal(batch);
        setMessages((prev) => {
          const next = dropResolvedPendingUsers(applyRunEventsToMessages(prev, batch));
          return signal === "fail" ? settleTranscriptMessages(next) : next;
        });
        setCurrent((prev) => {
          if (!prev || prev.id !== id) return prev;
          let status = prev.status;
          for (const event of batch) {
            if (event.kind === "run.idle" || event.kind === "agent.end") continue;
            status = (statusFromEventKind(event.kind, status) as Run["status"]) ?? status;
          }
          if (signal === "work") status = "RUNNING";
          return status === prev.status ? prev : { ...prev, status };
        });
        if (idleTimerRef.current) {
          window.clearTimeout(idleTimerRef.current);
          idleTimerRef.current = 0;
        }
        if (signal === "fail") {
          void refreshRuns();
        } else if (signal === "idle") {
          idleTimerRef.current = window.setTimeout(() => {
            idleTimerRef.current = 0;
            setMessages((prev) => settleTranscriptMessages(prev));
            setCurrent((prev) => (prev && prev.id === id ? { ...prev, status: "IDLE" } : prev));
            void refreshRuns();
          }, TURN_IDLE_GRACE_MS);
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
    async (id: string, opts?: { record?: boolean; keepPending?: boolean }) => {
      const previousId = runIdRef.current;
      runIdRef.current = id;
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
      // Reloading the same run (worker dispatch / refresh) must not wipe the
      // optimistic bubble. Follow-ups stay off the server transcript until the
      // worker takes them.
      if (previousId !== id && !opts?.keepPending) setPendingTurn(null);
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
        const settled = isActiveRunStatus(run.status) ? loaded : settleTranscriptMessages(loaded);
        setMessages((prev) => (previousId === id ? mergeUnresolvedPending(settled, prev) : settled));
        lastEventIdRef.current = snapshot?.lastEventId ?? null;
      } else {
        setMessages((prev) => (previousId === id ? mergeUnresolvedPending([], prev) : []));
        lastEventIdRef.current = null;
      }
      if (run.executionTarget?.loop === "desk") {
        // The files live on this machine, so the control plane has nothing to
        // diff. It has to be this run's own folder: reading the picker would
        // count changes in whatever folder is selected right now, which is the
        // wrong one as soon as a second local conversation is open.
        const runFolder = localRunFolder(run);
        setDiff(runFolder ? ((await deskBridge()?.diffStat?.(runFolder).catch(() => null)) ?? null) : null);
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
      const registered = await desk.setToken(tokenRef.current).catch(() => undefined);
      if (registered?.deskId) deskIdRef.current = registered.deskId;
      if (registered?.error) setAuthError(registered.error);
      const saved = await desk.getTarget().catch(() => undefined);
      if (saved) {
        const next = mergeDeskTarget(saved, deskIdRef.current || registered?.deskId);
        if (next.deskId) deskIdRef.current = next.deskId;
        setTarget(next);
        if (next.folder) setFolder(next.folder);
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
      const message = error instanceof Error ? error.message : "登录失败";
      setAuthError(message === "Failed to fetch" ? "连不上现网控制面。检查网络后重试，或换一份新的安装包。" : message);
    } finally {
      setAuthBusy(false);
    }
  };

  const pickLocalFolder = useCallback(async (kind?: DeskTarget["kind"]) => {
    const bridge = deskBridge();
    if (!bridge) return;
    const picked = asWorkspaceRef(await bridge.pickFolder());
    if (!picked) return;
    setFolder(picked.folder);
    setWorkspaces((await bridge.listWorkspaces?.().catch(() => [])) ?? []);
    const nextKind = kind && isLocalDeskKind(kind) ? kind : TARGET_DESK;
    applyTargetRef.current({
      kind: nextKind,
      folder: picked.folder,
      workspaceId: picked.id || undefined,
      deskId: deskIdRef.current,
    });
  }, []);

  /** Bring a local run's worker back on this machine, in the same folder. */
  const resumeLocalRun = useCallback(async (id: string, deskTarget?: ExecutionTarget | null, runFolder?: string) => {
    const bridge = deskBridge();
    const start = bridge?.startRun;
    if (!start) {
      setAuthError(STALE_DESK_HINT);
      return;
    }
    setAuthError("");
    const response = await api(tokenRef.current, `/v1/runs/${id}/desk-start`, { method: "POST" });
    const body = await readJson<{ assignment?: DeskAssignment; error?: string }>(response);
    if (response.ok && body.assignment) {
      await start(body.assignment, runFolder);
      return;
    }
    if (await bridge?.takeAssignment?.(id, runFolder).then((taken) => taken?.started)) {
      return;
    }
    // Older control planes have no desk-start. Handing the run back to this
    // same machine re-queues an assignment we can then claim.
    const deskId = deskTarget?.deskId || deskIdRef.current;
    if (!deskId) {
      setAuthError(MISSING_DESK_ID_HINT);
      return;
    }
    const handoff = await api(tokenRef.current, `/v1/runs/${id}/handoff`, {
      method: "POST",
      body: JSON.stringify({
        // Same-machine resume: the folder is `runFolder` (this run's path).
        // A local workspace id would make dispatch look it up on the server.
        target: { loop: "desk", tools: "desk", deskId },
      }),
    });
    if (!handoff.ok) {
      const failed = await readJson<{ error?: string }>(handoff);
      setAuthError(failed.error || body.error || "本机启动失败");
      return;
    }
    const retaken = await bridge?.takeAssignment?.(id, runFolder);
    if (!retaken?.started) {
      setAuthError("现网还没把这条对话交回这台电脑，稍等再试。");
    }
  }, []);

  const stopCurrentTurn = () => {
    if (!current) return;
    if (current.executionTarget?.loop === "desk") {
      void deskBridge()?.stopRun?.(current.id);
    }
    void api(token, `/v1/runs/${current.id}/abort`, { method: "POST" });
    setPendingTurn(null);
    setCurrent((prev) => (prev && prev.id === current.id ? { ...prev, status: "IDLE" } : prev));
  };

  const send = async (draft?: string, opts?: { asNew?: boolean; todo?: { id: string; title: string } | null }) => {
    const text = (draft ?? prompt).trim();
    if (!text || sending) return;
    // A failure from an earlier turn must not sit under the composer forever.
    setAuthError("");
    const local = isLocalDeskKind(target.kind);
    if (target.kind === TARGET_REMOTE && !folder) {
      setAuthError("Remote Control 要先选一个本机文件夹，网页才能在同一目录接着聊。");
      return;
    }
    let localDeskId = target.deskId || deskIdRef.current;
    if (local && !localDeskId) {
      const bridge = deskBridge();
      const [prefs, saved] = await Promise.all([
        bridge?.getPrefs?.().catch(() => undefined),
        bridge?.getTarget().catch(() => undefined),
      ]);
      localDeskId = prefs?.deskId || saved?.deskId || "";
      if (localDeskId) {
        deskIdRef.current = localDeskId;
        setTarget((prev) => mergeDeskTarget(prev, localDeskId));
      }
    }
    if (local && !localDeskId) {
      setAuthError(MISSING_DESK_ID_HINT);
      return;
    }
    const askPrefix = mode === "ask" ? "只阅读和回答，不要修改文件或执行会改状态的命令。\n\n" : "";
    const startNew = opts?.asNew || !runId;
    const boundTodo = opts && "todo" in opts ? opts.todo : pendingTodo;
    const composed = `${askPrefix}${startNew && boundTodo ? `待办：${boundTodo.title}\n\n` : ""}${text}`;
    const pending: PendingUser = {
      id: `pending-${Date.now()}`,
      text: composed,
      createdAt: new Date().toISOString(),
    };
    setSending(true);
    if (!draft) setPrompt("");
    setPendingTurn(pending);
    if (!startNew) {
      setMessages((prev) => appendPendingUser(prev, pending));
    }
    if (!startNew && current && !isActiveRunStatus(current.status)) {
      setCurrent({ ...current, status: "RUNNING" });
    }
    try {
      if (startNew) {
        const created = await readJson<Run & { assignment?: DeskAssignment; error?: string }>(
          await api(token, "/v1/runs", {
            method: "POST",
            body: JSON.stringify({
              prompt: composed,
              model: selectedModel || undefined,
              source: "desk",
              projectId: activeProject?.id,
              todoId: boundTodo?.id,
              expertId: expertPick.expertId,
              expertTeamId: expertPick.expertTeamId,
              // This window is the desk, so it starts the worker itself instead
              // of waiting to be handed its own run back.
              start: local ? "inline" : undefined,
              repoUrls: local
                ? folder
                  ? [folder]
                  : []
                : activeProject?.defaultRepoUrls?.length
                  ? activeProject.defaultRepoUrls
                  : [],
              target: local ? localRunTarget(target, localDeskId) : { loop: "cloud", tools: "cloud" },
            }),
          }),
        );
        if (created.error) throw new Error(created.error);
        setPendingTodo(null);
        setRuns((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        if (created.assignment) {
          const start = deskBridge()?.startRun;
          if (start) {
            await start(created.assignment, local ? folder : undefined);
          } else {
            setAuthError(STALE_DESK_HINT);
          }
        } else if (local) {
          // Production still queues desk runs for claim and does not return
          // an inline assignment. Pull it off the lease instead of waiting.
          await deskBridge()?.takeAssignment?.(created.id, folder);
        }
        await openRun(created.id, { keepPending: true });
        return;
      }
      await api(token, `/v1/runs/${runId}/follow-ups`, {
        method: "POST",
        body: JSON.stringify({ text: pending.text }),
      });
      setQueueEpoch((cur) => cur + 1);
      if (current?.executionTarget?.loop === "desk" && localStatuses[runId]?.state !== "running") {
        await resumeLocalRun(runId, current?.executionTarget, localRunFolder(current));
      }
    } catch (error) {
      setPendingTurn(null);
      setMessages((prev) => prev.filter((message) => message.id !== pending.id));
      setPrompt(text);
      setAuthError(error instanceof Error ? error.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  const applyTarget = useCallback((next: DeskTarget) => {
    const merged = mergeDeskTarget(next, deskIdRef.current);
    if (merged.deskId) deskIdRef.current = merged.deskId;
    setTarget(merged);
    void deskBridge()?.setTarget(merged);
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
    if (!bridge) return;
    const offStatus = bridge.onRunStatus?.((status) => {
      setLocalStatuses((prev) => ({ ...prev, [status.runId]: status }));
      if (status.state === "failed" && status.detail) {
        setAuthError(status.detail);
      }
      if (status.notice) {
        setLocalNotice(status.notice);
      }
      if (status.state === "running" || status.state === "stopped") {
        setPanelEpoch((n) => n + 1);
        void refreshRuns();
      }
    });
    const offDispatch = bridge.onDispatched?.(({ runId: id }) => {
      void refreshRuns();
      if (!runIdRef.current || runIdRef.current === id) {
        void openRunRef.current(id, { keepPending: true });
      }
    });
    const offTarget = bridge.onTarget?.((saved) => {
      const next = mergeDeskTarget(saved, deskIdRef.current);
      if (next.deskId) deskIdRef.current = next.deskId;
      setTarget(next);
      if (next.folder) setFolder(next.folder);
      void bridge.listWorkspaces?.().then(setWorkspaces).catch(() => undefined);
    });
    const offInbox = bridge.onInboxState?.((state) => {
      if (state.deskId) {
        deskIdRef.current = state.deskId;
        setTarget((prev) => mergeDeskTarget(prev, state.deskId));
      }
      if (state.error) setAuthError(state.error);
    });
    return () => {
      offStatus?.();
      offDispatch?.();
      offTarget?.();
      offInbox?.();
    };
  }, [refreshRuns]);

  useEffect(() => {
    const bridge = deskBridge();
    if (!bridge || !authed) return;
    void bridge.listWorkspaces?.().then(setWorkspaces).catch(() => undefined);
    void bridge
      .getPrefs?.()
      .then((value) => {
        setMaxLocalRuns(normalizeMaxLocalRuns(value.maxLocalRuns));
        if (value.deskId) {
          deskIdRef.current = value.deskId;
          setTarget((prev) => mergeDeskTarget(prev, value.deskId));
        }
      })
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
        runIdRef.current = null;
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
  }, [messages, pendingTurn, runId]);

  useEffect(() => {
    if (pendingTurn && pendingUserArrived(messages, pendingTurn)) {
      setPendingTurn(null);
    }
  }, [messages, pendingTurn]);

  // This window is the machine, so the local bar already says what the claim
  // handshake would: 正在启动 / 已在这台电脑上运行.
  const visible = withPendingUser(
    displayTranscriptMessages(messages, {
      hideDeskHandshake: true,
    }),
    pendingTurn,
  );
  const busy = Boolean(sending || pendingTurn || (current && isActiveRunStatus(current.status)));
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
        meta: runSearchMeta(run, repoLabel(run.repoUrls[0]), isCloudRun(run), formatRelShort(run.updatedAt)),
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
    runIdRef.current = null;
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
    setModelError("");
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
      setModelError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setModelBusy(false);
    }
  };

  const openSettings = (section: SettingsSection = "basics") => {
    setSearchOpen(false);
    setModelMenu(false);
    setSettingsSection(section);
    setNav("settings");
  };

  const modelNames = useMemo(() => {
    const names = [llm.model, selectedModel, ...savedModels.map((item) => item.name)].filter(
      (item): item is string => Boolean(item),
    );
    return [...new Set(names)];
  }, [llm.model, savedModels, selectedModel]);

  const branch = current?.branchName || "";

  const localRun = useMemo(() => localRunView(current, localStatuses), [current, localStatuses]);
  const turnLive = Boolean(sending || pendingTurn || current?.status === "RUNNING");
  const panelIsLocal = current ? localRun.isLocal : isLocalDeskKind(target.kind);
  // An open run answers with its own folder; only the empty composer follows the
  // picker. Letting an open run fall back to the picker would point the file
  // tree and the diff at the wrong repo as soon as two local runs exist.
  const localFolder = current ? localRun.folder : panelIsLocal ? folder : "";
  const runningRunIds = useMemo(() => runningLocalRunIds(localStatuses), [localStatuses]);
  const otherLocalRunCount = otherRunningLocalRuns(localStatuses, current?.id);

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
          <Tooltip content="后退">
            <span>
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
            </span>
          </Tooltip>
          <Tooltip content="前进">
            <span>
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
            </span>
          </Tooltip>
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
            <Tooltip content="筛选会话">
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
            </Tooltip>
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
            runningLocalRunIds={runningRunIds}
            formatRel={formatRelShort}
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
            <Tooltip content="设置" side="top">
              <button type="button" className="icon-btn" aria-label="Settings" onClick={() => openSettings()}>
                <IconGear />
              </button>
            </Tooltip>
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
        <Tooltip content={panelOpen ? "收起右侧栏" : "Files / Terminal"} side="left">
          <span className="panel-toggle-wrap">
            <button
              type="button"
              className={`panel-toggle${panelOpen ? " on" : ""}`}
              aria-label={panelOpen ? "收起右侧栏" : "打开右侧栏"}
              onClick={() => setPanelOpen((cur) => !cur)}
            >
              <IconPanelRight size={15} />
            </button>
          </span>
        </Tooltip>
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
              runIdRef.current = null;
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
          <SettingsPage
            section={settingsSection}
            onSection={setSettingsSection}
            maxLocalRuns={maxLocalRuns}
            onMaxLocalRuns={(value) => {
              const next = normalizeMaxLocalRuns(value);
              setMaxLocalRuns(next);
              void deskBridge()?.setPrefs?.({ maxLocalRuns: next });
            }}
            name={modelName}
            setName={setModelName}
            apiKey={modelKey}
            setApiKey={setModelKey}
            baseUrl={modelBaseUrl}
            setBaseUrl={setModelBaseUrl}
            configured={llm.configured}
            busy={modelBusy}
            error={modelError || undefined}
            newApi={llm.newApi}
            onSave={() => void saveModel()}
          />
        ) : (
          <section
            className={`page chat-page${current?.projectId ? " project-chat" : current ? " personal-chat" : ""}${
              panelOpen ? " with-panel" : ""
            }`}
          >
            <div className="chat-stage">
            {localRun.isLocal ? (
              <div className="local-bar">
                <IconComputer size={13} />
                <span>{localRunLabel(current)} · {folderName(localFolder)}</span>
                {localRun.status?.state === "starting" ? <em>正在启动…</em> : null}
                {localRun.status?.state === "running" ? <em className="ok">已在这台电脑上运行</em> : null}
                {localRun.status?.state === "failed" ? (
                  <em className="bad">{localRun.status.detail || "启动失败"}</em>
                ) : null}
                {/* A worker exits after its turn, so "no process" is the resting
                    state, not something to recover from. */}
                {localRun.idle ? <em>本机就绪 · 发送即在这里继续</em> : null}
                {localRun.needsRestart ? (
                  <button
                    type="button"
                    className="ghost"
                    title="重新在这台电脑上拉起这条对话的 Agent 进程"
                    onClick={() =>
                      current && void resumeLocalRun(current.id, current.executionTarget, localRun.folder)
                    }
                  >
                    在这台电脑上继续
                  </button>
                ) : null}
                {otherLocalRunCount > 0 ? (
                  <em title="另外这些对话也在这台电脑上改文件">另有 {otherLocalRunCount} 条在本机跑</em>
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
                busy={busy}
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
                onAbort={stopCurrentTurn}
                onTransferred={(next) => {
                  setCurrent(next);
                  setRuns((prev) => [next, ...prev.filter((item) => item.id !== next.id && item.id !== current.id)]);
                  if (next.id !== current.id) {
                    void openRun(next.id);
                  }
                }}
                onCopy={(text) => void copyText(text)}
                queueEpoch={queueEpoch}
              />
            ) : current ? (
              <PersonalChatPage
                title={title}
                current={current}
                visible={visible}
                activity={activity}
                busy={busy}
                user={user}
                feedRef={feedRef}
                onCopy={(text) => void copyText(text)}
              />
            ) : null}

            <footer className={`composer-wrap${current ? "" : " home-wrap"}`}>
              {current ? null : (
                <ContextBar
                  workspaces={workspaces}
                  folder={folder}
                  onWorkspace={(picked) => {
                    setFolder(picked.folder);
                    applyTarget({
                      kind: isLocalDeskKind(target.kind) ? target.kind : TARGET_DESK,
                      folder: picked.folder,
                      workspaceId: picked.id,
                      deskId: target.deskId,
                    });
                  }}
                  onClearFolder={() => {
                    setFolder("");
                    applyTarget({
                      kind: TARGET_DESK,
                      folder: "",
                      workspaceId: undefined,
                      deskId: target.deskId,
                    });
                  }}
                  onPickFolder={(kind) => void pickLocalFolder(kind)}
                  branch={branch || "main"}
                  targetKind={target.kind}
                  canRunLocal={canRunLocal}
                  onTarget={(kind) =>
                    applyTarget({ ...target, kind, folder: isLocalDeskKind(kind) ? folder : target.folder })
                  }
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
                onAddModel={() => openSettings("models")}
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
                waiting={turnLive}
                onStop={current ? stopCurrentTurn : undefined}
              />
              {current ? (
                <p className="composer-note">
                  {current.projectId ? "内容由模型生成，请核实重要信息" : "内容由 AI 生成，请核实重要信息"}
                </p>
              ) : null}
              {authError ? <p className="error toast-inline">{authError}</p> : null}
              {localNotice ? (
                <p className="toast-inline local-notice">
                  {localNotice}
                  <button type="button" className="ghost" onClick={() => setLocalNotice("")}>
                    知道了
                  </button>
                </p>
              ) : null}
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

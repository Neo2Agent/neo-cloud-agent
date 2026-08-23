import type { PublicLlmSettings } from "@neo-cloud-agent/contracts";
import type { Automation } from "@neo-cloud-agent/contracts/automation";
import type { RunEvent, TranscriptMessage, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { applyRunEventsToMessages, displayTranscriptMessages, settleTranscriptMessages, transcriptGroups } from "@neo-cloud-agent/contracts/transcript";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { api, persistSessionToken, readJson } from "./api";
import { deskBridge, withApiBase, type DeskTarget } from "./desk";
import { isLoopbackOrigin } from "../src/ports";
import { isActiveRunStatus, isTerminalTurnEvent, parseSse, runEventsQuery } from "../src/stream";
import { ToolCard } from "./ToolCard";
import {
  AutomationCreateForm,
  AutomationsPage,
  ChatComposer,
  ContextBar,
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
  IconChevron,
  IconCloud,
  IconCopy,
  IconForward,
  IconGear,
  IconNewChat,
  IconPeople,
  IconProjects,
  IconSearch,
  IconSort,
  IconThumbsDown,
  IconThumbsUp,
} from "./icons";

type NavId = "chats" | "automations" | "projects" | "settings";

function preview(text: string, n = 56): string {
  return (text || "New Agent").replace(/\s+/g, " ").slice(0, n);
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

function isThought(message: TranscriptMessage): boolean {
  if (message.tools?.length || message.blocks?.some((block) => block.type === "tool")) return false;
  const blob = `${message.kind ?? ""} ${message.text}`.toLowerCase();
  return blob.includes("thought") || blob.includes("thinking") || blob.includes("reasoning");
}

function isStatus(message: TranscriptMessage): boolean {
  if (message.role !== "setup") return false;
  return !isThought(message);
}

function looksLikeCi(text: string): boolean {
  return /\bci\b|checks completed|github actions|all \d+ (ci )?check/i.test(text);
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
  const [runs, setRuns] = useState<Run[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
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
  const [diff, setDiff] = useState<{ added: number; removed: number } | null>(null);
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

  const refreshProjects = useCallback(async () => {
    const response = await api(tokenRef.current, "/v1/projects");
    if (!response.ok) return;
    const body = await readJson<{ projects?: Project[] }>(response);
    setProjects(body.projects ?? []);
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
      if (diffRes.ok) {
        setDiff(diffStats(await diffRes.text()));
      } else {
        setDiff(null);
      }
      listen(id, lastEventIdRef.current);
    },
    [listen],
  );

  const finishLogin = useCallback(async () => {
    const me = await api(tokenRef.current, "/v1/me");
    if (!me.ok) throw new Error("unauthorized");
    const body = await readJson<{ user?: { email?: string; username?: string } }>(me);
    setUser(body.user?.username || body.user?.email || "desk");
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
    await Promise.all([refreshRuns(), refreshAutomations(), refreshProjects(), refreshLlm()]);
  }, [refreshAutomations, refreshLlm, refreshProjects, refreshRuns]);

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

  const send = async () => {
    const text = prompt.trim();
    if (!text || sending) return;
    const askPrefix = mode === "ask" ? "只阅读和回答，不要修改文件或执行会改状态的命令。\n\n" : "";
    setSending(true);
    setPrompt("");
    try {
      if (!runId) {
        const created = await readJson<Run & { error?: string }>(
          await api(token, "/v1/runs", {
            method: "POST",
            body: JSON.stringify({
              prompt: `${askPrefix}${text}`,
              model: selectedModel || undefined,
              source: "desk",
              projectId: activeProject?.id,
              repoUrls:
                target.kind === "desk" && folder
                  ? [folder]
                  : composerRepo
                    ? [composerRepo]
                    : activeProject?.defaultRepoUrls?.length
                      ? activeProject.defaultRepoUrls
                      : [],
              target:
                target.kind === "desk"
                  ? { loop: "desk", tools: "desk", deskId: target.deskId }
                  : { loop: "cloud", tools: "cloud" },
            }),
          }),
        );
        if (created.error) throw new Error(created.error);
        setRuns((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        await openRun(created.id);
        return;
      }
      await api(token, `/v1/runs/${runId}/follow-ups`, {
        method: "POST",
        body: JSON.stringify({ text: `${askPrefix}${text}` }),
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  const applyTarget = (next: DeskTarget) => {
    setTarget(next);
    void deskBridge()?.setTarget(next);
  };

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setModelMenu(false);
        setContextOpen(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!authed) return;
    const onShow = () => {
      if (document.visibilityState === "hidden") return;
      void refreshRuns();
    };
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [authed, refreshRuns]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages, runId]);

  const visible = displayTranscriptMessages(messages);
  const grouped = useMemo(() => {
    let list = runs;
    if (activeProject) {
      list = list.filter((run) => run.projectId === activeProject.id);
    }
    const map = new Map<string, Run[]>();
    for (const run of list) {
      const key = repoLabel(run.repoUrls[0]);
      const bucket = map.get(key) ?? [];
      bucket.push(run);
      map.set(key, bucket);
    }
    return [...map.entries()];
  }, [activeProject, runs]);

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

  useEffect(() => {
    setRepoOpen((cur) => {
      const next = { ...cur };
      for (const [name] of grouped) {
        if (next[name] === undefined) next[name] = true;
      }
      return next;
    });
  }, [grouped]);

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
        body: JSON.stringify({ name: projectName.trim(), instruction: projectInstruction }),
      });
      const body = await readJson<Project & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "创建失败");
      setProjectName("");
      setProjectInstruction("");
      await refreshProjects();
      setActiveProject(body);
      setProjectModal(false);
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
    if (!llm.configured && !modelKey.trim()) return;
    setModelBusy(true);
    setAuthError("");
    try {
      const response = await api(token, "/v1/settings/llm", {
        method: "POST",
        body: JSON.stringify({
          upstream: "openai",
          model: modelName.trim(),
          baseUrl: (modelBaseUrl.trim() || OPENAI_BASE_URL).replace(/\/$/, ""),
          ...(modelKey.trim() ? { apiKey: modelKey.trim() } : {}),
        }),
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
    map.set("", "Inbox");
    for (const run of runs) {
      const url = run.repoUrls[0] || "";
      if (url) map.set(url, repoPath(url));
    }
    if (folder) map.set(folder, repoPath(folder));
    for (const url of activeProject?.defaultRepoUrls ?? []) {
      if (url) map.set(url, repoPath(url));
    }
    return [...map.entries()].map(([url, label]) => ({ url, label }));
  }, [activeProject, folder, runs]);

  const contextRepoUrl = current?.repoUrls[0] || composerRepo;
  const contextRepoName = current ? repoPath(current.repoUrls[0]) : repoPath(composerRepo) || repoChoices.find((item) => item.url === composerRepo)?.label || "Inbox";

  const branch = current?.branchName || "";

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
              setNav("projects");
            }}
          >
            <span className="rail-icon">
              <IconProjects />
            </span>
            Projects
          </button>
        </nav>

        <div className="repo-head">
          {activeProject ? (
            <button type="button" className="repo-filter" onClick={() => setActiveProject(null)}>
              {activeProject.name}
              <span aria-hidden="true">×</span>
            </button>
          ) : (
            <span>Repositories</span>
          )}
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
          {grouped.length === 0 ? (
            <p className="pane-note">
              {activeProject ? "这个项目还没有对话。从 New Chat 开始。" : "还没有对话。从 New Chat 开始。"}
            </p>
          ) : (
            grouped.map(([name, list]) => (
              <div key={name} className="repo-group">
                <button
                  type="button"
                  className="repo-folder"
                  onClick={() => setRepoOpen((cur) => ({ ...cur, [name]: cur[name] === false }))}
                >
                  <IconChevron open={repoOpen[name] !== false} size={14} />
                  <span>{name}</span>
                </button>
                {repoOpen[name] !== false
                  ? list.map((run) => {
                      const active = run.id === runId;
                      return (
                        <button
                          key={run.id}
                          type="button"
                          className={`chat-row${active ? " active" : ""}`}
                          onClick={() => void openRun(run.id)}
                        >
                          <span className={`chat-dot${active ? " on" : ""}`} />
                          <span className="chat-title">{preview(run.prompt, 40)}</span>
                          <span className="chat-meta">
                            <IconPeople size={13} />
                            {isCloudRun(run) ? <IconCloud size={13} /> : null}
                            <span>{formatRel(run.updatedAt)}</span>
                          </span>
                        </button>
                      );
                    })
                  : null}
              </div>
            ))
          )}
        </div>

        <div className="rail-foot">
          <div className="profile">
            <span className="avatar">{initials(user)}</span>
            <span className="profile-name">{user}</span>
            {remoteApiHost ? <span className="prod-tag">生产</span> : null}
            <button type="button" className="icon-btn" aria-label="Settings" onClick={openSettings}>
              <IconGear />
            </button>
          </div>
        </div>
      </aside>

      <main className="stage">
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
        ) : nav === "projects" ? (
          <ProjectsPage
            items={projects}
            query={projectQuery}
            setQuery={setProjectQuery}
            activeId={activeProject?.id}
            onCreate={() => {
              setAuthError("");
              setProjectName("");
              setProjectInstruction("");
              setProjectModal(true);
            }}
            onSelect={setActiveProject}
          />
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
            onSave={() => void saveModel()}
          >
            <div className="settings-card">
              <h2>This computer</h2>
              <label>
                <span>Target</span>
                <select
                  value={target.kind}
                  onChange={(event) => applyTarget({ ...target, kind: event.target.value as DeskTarget["kind"] })}
                >
                  <option value="cloud">Cloud</option>
                  <option value="desk" disabled={!canRunLocal}>
                    {canRunLocal ? "This Computer" : "This Computer (needs Electron)"}
                  </option>
                  <option value="remote" disabled>
                    Remote SSH
                  </option>
                </select>
              </label>
              {target.kind === "desk" ? (
                <button
                  type="button"
                  className="folder-btn"
                  onClick={() => {
                    void deskBridge()
                      ?.pickFolder()
                      .then((picked) => {
                        if (!picked) return;
                        setFolder(picked);
                        applyTarget({ ...target, kind: "desk", folder: picked });
                      });
                  }}
                >
                  {folder || "Folder…"}
                </button>
              ) : null}
            </div>
          </ModelSettingsPage>
        ) : (
          <section className="page chat-page">
            {current ? (
              <>
                <header className="stage-head">
                  <h1>{title}</h1>
                  {isCloudRun(current) ? <IconCloud size={18} /> : null}
                </header>
                <div className="feed" ref={feedRef}>
                  {!visible.some((message) => message.role === "user") ? (
                    <article className="user-card">
                      <div className="user-card-text">{current.prompt}</div>
                    </article>
                  ) : null}
                  {visible.map((message) => {
                    if (message.role === "user") {
                      return (
                        <article key={message.id} className="user-card">
                          <div className="user-card-text">{message.text || current.prompt}</div>
                          {message.images?.length ? (
                            <div className="thumbs">
                              {message.images.map((image, index) => (
                                <img key={`${message.id}-${index}`} src={`data:${image.mediaType};base64,${image.data}`} alt="" />
                              ))}
                            </div>
                          ) : null}
                        </article>
                      );
                    }
                    if (isThought(message)) {
                      return (
                        <details key={message.id} className="thought">
                          <summary>Thought briefly.</summary>
                          <p>{message.text}</p>
                        </details>
                      );
                    }
                    if (isStatus(message) || looksLikeCi(message.text)) {
                      return (
                        <div key={message.id} className={`status-line${looksLikeCi(message.text) ? " ok" : ""}`}>
                          <span />
                          <p>{message.text}</p>
                        </div>
                      );
                    }
                    const groups = transcriptGroups(message);
                    if (groups.length === 0) {
                      return message.text ? (
                        <article key={message.id} className="assistant-block">
                          <div className="assistant-text">{message.text}</div>
                        </article>
                      ) : null;
                    }
                    const lastText = [...groups].reverse().find((group) => group.type === "text");
                    return (
                      <div key={message.id} className="assistant-turn">
                        {groups.map((group, index) => {
                          if (group.type === "tools") {
                            return (
                              <div key={`${message.id}-tools-${index}`} className="tool-stack">
                                {group.tools.map((tool, toolIndex) => (
                                  <ToolCard key={tool.id ?? `${tool.name}-${toolIndex}`} tool={tool} />
                                ))}
                              </div>
                            );
                          }
                          return (
                            <article key={`${message.id}-text-${index}`} className="assistant-block">
                              <div className="assistant-text">{group.text}</div>
                              {group === lastText ? (
                                <div className="assistant-actions">
                                  <button type="button" className="icon-btn" aria-label="Good response">
                                    <IconThumbsUp />
                                  </button>
                                  <button type="button" className="icon-btn" aria-label="Bad response">
                                    <IconThumbsDown />
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    aria-label="Copy"
                                    onClick={() => void copyText(group.text)}
                                  >
                                    <IconCopy />
                                  </button>
                                  <span className="ago">{formatRel(message.createdAt)}</span>
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            <footer className={`composer-wrap${current ? "" : " home-wrap"}`}>
              <ContextBar
                repoLabel={contextRepoName}
                repos={repoChoices}
                repoUrl={contextRepoUrl}
                onRepo={setComposerRepo}
                branch={current?.branchName || branch || "main"}
                targetKind={current ? (isCloudRun(current) ? "cloud" : "desk") : target.kind}
                canRunLocal={canRunLocal}
                onTarget={(kind) => applyTarget({ ...target, kind, folder: kind === "desk" ? folder : target.folder })}
                open={contextOpen}
                setOpen={setContextOpen}
                locked={Boolean(current)}
              />
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
                placeholder={runId ? "Send follow-up" : "Plan, Build, / for skills, @ for context"}
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
              />
              {authError ? <p className="error toast-inline">{authError}</p> : null}
              {copied ? <p className="copied">Copied</p> : null}
            </footer>
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
            searchRef={searchRef}
            onOpenRun={(id) => {
              setSearchOpen(false);
              void openRun(id);
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

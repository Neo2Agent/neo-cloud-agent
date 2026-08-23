import type { Automation } from "@neo-cloud-agent/contracts/automation";
import type { RunEvent, TranscriptMessage, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { applyRunEventsToMessages, displayTranscriptMessages } from "@neo-cloud-agent/contracts/transcript";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, persistSessionToken, readJson } from "./api";
import { deskBridge, withApiBase, type DeskTarget } from "./desk";
import {
  IconAddRepo,
  IconAutomations,
  IconBack,
  IconChevron,
  IconCloud,
  IconCopy,
  IconForward,
  IconGear,
  IconMic,
  IconNewChat,
  IconPeople,
  IconPlus,
  IconProjects,
  IconSearch,
  IconSort,
  IconSync,
  IconThumbsDown,
  IconThumbsUp,
} from "./icons";

type NavId = "chats" | "search" | "automations" | "projects" | "settings";

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

function parseSse(raw: string): RunEvent | null {
  try {
    const event = JSON.parse(raw) as RunEvent;
    return event?.id && event.kind ? event : null;
  } catch {
    return null;
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
  const [runId, setRunId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Run | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const [nav, setNav] = useState<NavId>("chats");
  const [target, setTarget] = useState<DeskTarget>({ kind: "cloud" });
  const [folder, setFolder] = useState("");
  const [mode, setMode] = useState<"agent" | "ask">("agent");
  const [model, setModel] = useState("Extra High Fast");
  const [repoOpen, setRepoOpen] = useState<Record<string, boolean>>({});
  const [diff, setDiff] = useState<{ added: number; removed: number } | null>(null);
  const [copied, setCopied] = useState("");
  const [trail, setTrail] = useState<{ ids: string[]; at: number }>({ ids: [], at: -1 });
  const tokenRef = useRef("");
  const sourceRef = useRef<EventSource | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const canRunLocal = Boolean(deskBridge()?.canRunLocal);

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

  const listen = useCallback(
    (id: string) => {
      sourceRef.current?.close();
      const params = tokenRef.current ? `?access_token=${encodeURIComponent(tokenRef.current)}` : "";
      const source = new EventSource(withApiBase(`/v1/runs/${id}/events${params}`));
      sourceRef.current = source;
      source.onmessage = (event) => {
        const parsed = parseSse(event.data);
        if (!parsed) return;
        setMessages((prev) => applyRunEventsToMessages(prev, [parsed]));
        if (parsed.kind === "run.idle" || parsed.kind === "run.error") {
          void refreshRuns();
        }
      };
    },
    [refreshRuns],
  );

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
        setMessages(body.snapshot?.messages ?? []);
      } else {
        setMessages([]);
      }
      if (diffRes.ok) {
        setDiff(diffStats(await diffRes.text()));
      } else {
        setDiff(null);
      }
      listen(id);
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
    await Promise.all([refreshRuns(), refreshAutomations(), refreshProjects()]);
  }, [refreshAutomations, refreshProjects, refreshRuns]);

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
    return () => sourceRef.current?.close();
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
              source: "desk",
              projectId: activeProject?.id,
              repoUrls:
                target.kind === "desk" && folder
                  ? [folder]
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
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages, runId]);

  const visible = displayTranscriptMessages(messages);
  const filtered = useMemo(() => {
    let list = runs;
    if (activeProject) {
      list = list.filter((run) => run.projectId === activeProject.id);
    }
    const q = query.trim().toLowerCase();
    if (nav !== "search" || !q) return list;
    return list.filter((run) => {
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
    });
  }, [activeProject, nav, projects, query, runs]);

  const grouped = useMemo(() => {
    const map = new Map<string, Run[]>();
    for (const run of filtered) {
      const key = repoLabel(run.repoUrls[0]);
      const list = map.get(key) ?? [];
      list.push(run);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered]);

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
    setNav("chats");
    sourceRef.current?.close();
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
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "创建失败");
    } finally {
      setProjectBusy(false);
    }
  };
  const branch = current?.branchName || "";
  const statusPlace = current ? (isCloudRun(current) ? "Cloud" : "This Computer") : target.kind === "desk" ? "This Computer" : "Cloud";

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
    <div className="agents-app">
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
          <button type="button" className="rail-item" onClick={newChat}>
            <span className="rail-icon">
              <IconNewChat />
            </span>
            New Chat
          </button>
          <button
            type="button"
            className={`rail-item${nav === "search" ? " on" : ""}`}
            onClick={() => {
              setNav("search");
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
            onClick={() => setNav("automations")}
          >
            <span className="rail-icon">
              <IconAutomations />
            </span>
            Automations
          </button>
          <button
            type="button"
            className={`rail-item${nav === "projects" ? " on" : ""}`}
            onClick={() => setNav("projects")}
          >
            <span className="rail-icon">
              <IconProjects />
            </span>
            Projects
          </button>
        </nav>

        <div className="repo-head">
          <span>{activeProject ? activeProject.name : "Repositories"}</span>
          <div className="repo-head-actions">
            <button type="button" className="icon-btn" aria-label="Filter repositories" onClick={() => setNav("search")}>
              <IconSort />
            </button>
            <button type="button" className="icon-btn" aria-label="Add repository" onClick={newChat}>
              <IconAddRepo />
            </button>
          </div>
        </div>

        <div className="repo-tree">
          {nav === "search" ? (
            <input
              className="search"
              value={query}
              placeholder="Search agents"
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}

          {grouped.length === 0 ? (
            <p className="pane-note">{query ? "没有匹配的对话。" : "还没有对话。从 New Chat 开始。"}</p>
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
            <button type="button" className="icon-btn" aria-label="Settings" onClick={() => setNav("settings")}>
              <IconGear />
            </button>
          </div>
        </div>
      </aside>

      <main className="stage">
        <div className="stage-col">
        {nav === "automations" ? (
          <>
            <header className="stage-head">
              <h1>Automations</h1>
            </header>
            <div className="feed">
              {automations.length === 0 ? (
                <div className="empty-copy">
                  <p>还没有定时任务。Automations 走同一控制面 /v1/automations。</p>
                </div>
              ) : (
                automations.map((item) => (
                  <article key={item.id} className="user-card">
                    <div className="user-card-text">{item.name || item.prompt}</div>
                    <p className="pane-note">
                      {item.enabled ? "On" : "Off"} · {item.schedule.kind}
                    </p>
                  </article>
                ))
              )}
            </div>
          </>
        ) : nav === "projects" ? (
          <>
            <header className="stage-head">
              <h1>Projects</h1>
            </header>
            <div className="feed">
              <form
                className="project-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createProject();
                }}
              >
                <p className="user-card-text">新建项目</p>
                <label>
                  名称
                  <input
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="例如：官网改版"
                    autoComplete="off"
                  />
                </label>
                <label>
                  项目指令
                  <textarea
                    value={projectInstruction}
                    onChange={(event) => setProjectInstruction(event.target.value)}
                    placeholder="给这个项目里所有对话看的规则，可先留空"
                  />
                </label>
                <button type="submit" disabled={projectBusy || !projectName.trim()}>
                  {projectBusy ? "创建中…" : "创建项目"}
                </button>
              </form>
              {projects.length === 0 ? (
                <div className="empty-copy">
                  <p>还没有项目。建一个之后，新对话可以带上同一套仓库和指令。</p>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className={`project-card${!activeProject ? " active" : ""}`}
                    onClick={() => setActiveProject(null)}
                  >
                    <strong>全部对话</strong>
                    <p className="pane-note">不按项目过滤侧栏。</p>
                  </button>
                  {projects.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`project-card${activeProject?.id === item.id ? " active" : ""}`}
                      onClick={() => {
                        setActiveProject(item);
                        setNav("chats");
                      }}
                    >
                      <strong>{item.name}</strong>
                      <p className="pane-note">
                        {item.members.length} 人 · {item.instruction || "还没写指令"}
                      </p>
                    </button>
                  ))}
                </>
              )}
            </div>
          </>
        ) : nav === "settings" ? (
          <>
            <header className="stage-head">
              <h1>Settings</h1>
            </header>
            <div className="feed">
              <div className="project-form">
                <p className="user-card-text">Desk 执行目标</p>
                <label>
                  Target
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
                <label>
                  Mode
                  <select value={mode} onChange={(event) => setMode(event.target.value as "agent" | "ask")}>
                    <option value="agent">Agent</option>
                    <option value="ask">Ask</option>
                  </select>
                </label>
                <p className="pane-note">Ask 只加提示前缀。Provider key 仍在 gateway 的设置里。</p>
              </div>
            </div>
          </>
        ) : nav === "search" ? (
          <>
            <header className="stage-head">
              <h1>Search</h1>
            </header>
            <div className="feed">
              <input
                ref={searchRef}
                className="search search-main"
                value={query}
                placeholder="搜索对话、仓库、分支、状态或项目"
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
              />
              {!query.trim() ? (
                <div className="empty-copy">
                  <p>从 /v1/runs 里搜已有对话。结果同时过滤左侧仓库树。</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="empty-copy">
                  <p>没有匹配「{query.trim()}」的对话。</p>
                </div>
              ) : (
                filtered.map((run) => (
                  <button key={run.id} type="button" className="search-hit" onClick={() => void openRun(run.id)}>
                    <strong>{preview(run.prompt, 72)}</strong>
                    <p className="pane-note">
                      {repoLabel(run.repoUrls[0])} · {isCloudRun(run) ? "Cloud" : "This Computer"} · {run.status} ·{" "}
                      {formatRel(run.updatedAt)}
                    </p>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
        <header className="stage-head">
          <h1>{title}</h1>
          {!current || isCloudRun(current) ? <IconCloud size={18} /> : null}
        </header>

        <div className="feed" ref={feedRef}>
          {!current && visible.length === 0 ? (
            <div className="empty-copy">
              <p>这是 Agents Window，不是完整编辑器。对话按仓库分组，右侧数据来自现有 /v1。</p>
            </div>
          ) : null}

          {current && !visible.some((message) => message.role === "user") ? (
            <article className="user-card">
              <div className="user-card-text">{current.prompt}</div>
            </article>
          ) : null}

          {visible.map((message) => {
            if (message.role === "user") {
              return (
                <article key={message.id} className="user-card">
                  <div className="user-card-text">{message.text || current?.prompt}</div>
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
            return (
              <article key={message.id} className="assistant-block">
                <div className="assistant-text">{message.text}</div>
                <div className="assistant-actions">
                  <button type="button" className="icon-btn" aria-label="Good response">
                    <IconThumbsUp />
                  </button>
                  <button type="button" className="icon-btn" aria-label="Bad response">
                    <IconThumbsDown />
                  </button>
                  <button type="button" className="icon-btn" aria-label="Copy" onClick={() => void copyText(message.text)}>
                    <IconCopy />
                  </button>
                  <span className="ago">{formatRel(message.createdAt)}</span>
                </div>
              </article>
            );
          })}
        </div>

        <footer className="composer-wrap">
          {current ? (
            <div className="chips">
              {diff && (diff.added > 0 || diff.removed > 0) ? (
                <button type="button" className="chip">
                  Changes <em className="add">+{diff.added}</em> <em className="del">-{diff.removed}</em>
                </button>
              ) : null}
              {branch ? (
                <button type="button" className="chip" onClick={() => void copyText(branch)}>
                  Checkout {branch}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="composer">
            <button type="button" className="plus" aria-label="Attach">
              <IconPlus />
            </button>
            <textarea
              ref={taRef}
              value={prompt}
              placeholder={runId ? "Send follow-up" : "Describe a task"}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={onComposerKey}
              rows={1}
            />
            <select className="model" value={mode} onChange={(event) => setMode(event.target.value as "agent" | "ask")} aria-label="Mode">
              <option value="agent">Agent</option>
              <option value="ask">Ask</option>
            </select>
            <select className="model" value={model} onChange={(event) => setModel(event.target.value)} aria-label="Model">
              <option>Extra High Fast</option>
              <option>High Fast</option>
              <option>Default</option>
            </select>
            <button type="button" className="icon-btn mic" aria-label="Voice">
              <IconMic />
            </button>
          </div>

          <div className="status-bar">
            <span className="mono">{branch || "untracked"}</span>
            <button
              type="button"
              className="cloud-pill"
              onClick={() => {
                if (current) return;
                applyTarget({
                  ...target,
                  kind: target.kind === "cloud" && canRunLocal ? "desk" : "cloud",
                });
              }}
            >
              <IconCloud size={14} />
              {statusPlace}
            </button>
            <span className={`sync${sending ? " spin" : ""}`} aria-hidden="true">
              <IconSync size={14} />
            </span>
          </div>
          {authError ? <p className="error toast-inline">{authError}</p> : null}
          {copied ? <p className="copied">Copied</p> : null}
        </footer>
          </>
        )}
        </div>
      </main>
    </div>
  );
}

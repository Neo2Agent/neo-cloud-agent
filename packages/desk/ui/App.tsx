import type { Automation } from "@neo-cloud-agent/contracts/automation";
import type { RunEvent, TranscriptMessage, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { applyRunEventsToMessages, displayTranscriptMessages } from "@neo-cloud-agent/contracts/transcript";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, persistSessionToken, readJson } from "./api";
import { deskBridge, withApiBase, type DeskTarget } from "./desk";

type NavId = "chats" | "search" | "automations";
type ContextTab = "overview" | "files" | "terminal" | "diff";

function preview(text: string, n = 56): string {
  return (text || "新对话").replace(/\s+/g, " ").slice(0, n);
}

function repoLabel(url?: string): string {
  if (!url) return "workspace";
  const clean = url.replace(/\/$/, "").replace(/\.git$/, "");
  const parts = clean.split("/").filter(Boolean);
  return parts.slice(-2).join(" / ") || clean;
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
  const part = value.trim().split(/[@\s./]+/)[0] || "N";
  return part.slice(0, 1).toUpperCase();
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
  const [runId, setRunId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Run | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const [nav, setNav] = useState<NavId>("chats");
  const [contextTab, setContextTab] = useState<ContextTab>("overview");
  const [target, setTarget] = useState<DeskTarget>({ kind: "cloud" });
  const [folder, setFolder] = useState("");
  const [mode, setMode] = useState<"agent" | "ask">("agent");
  const [contextText, setContextText] = useState("");
  const tokenRef = useRef("");
  const sourceRef = useRef<EventSource | null>(null);
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
    async (id: string) => {
      setRunId(id);
      setNav("chats");
      setContextTab("overview");
      const [runRes, transcriptRes] = await Promise.all([
        api(tokenRef.current, `/v1/runs/${id}`),
        api(tokenRef.current, `/v1/runs/${id}/transcript?limit=80`),
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
      listen(id);
    },
    [listen],
  );

  const finishLogin = useCallback(async () => {
    const me = await api(tokenRef.current, "/v1/me");
    if (!me.ok) throw new Error("unauthorized");
    const body = await readJson<{ user?: { email?: string } }>(me);
    setUser(body.user?.email ?? "desk");
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
    await Promise.all([refreshRuns(), refreshAutomations()]);
  }, [refreshAutomations, refreshRuns]);

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
              repoUrls: target.kind === "desk" && folder ? [folder] : [],
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

  const loadContext = useCallback(
    async (tab: ContextTab) => {
      if (!runId || tab === "overview") {
        setContextText("");
        return;
      }
      const path =
        tab === "files"
          ? `/v1/runs/${runId}/files`
          : tab === "terminal"
            ? `/v1/runs/${runId}/diagnostics`
            : `/v1/runs/${runId}/diff`;
      const response = await api(tokenRef.current, path);
      const body = await response.text();
      setContextText(body.slice(0, 4000) || "暂无内容");
    },
    [runId],
  );

  useEffect(() => {
    void loadContext(contextTab);
  }, [contextTab, loadContext]);

  const visible = displayTranscriptMessages(messages);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((run) => run.prompt.toLowerCase().includes(q) || run.id.toLowerCase().includes(q));
  }, [query, runs]);
  const repo = current?.repoUrls?.[0] || runs[0]?.repoUrls?.[0] || "";
  const prs = current?.pullRequests?.length
    ? current.pullRequests
    : runs.flatMap((run) => run.pullRequests ?? []).slice(0, 6);

  const newChat = () => {
    setRunId(null);
    setCurrent(null);
    setMessages([]);
    setNav("chats");
    sourceRef.current?.close();
  };

  if (!authed) {
    return (
      <div className="shell">
        <div className="menubar">
          <span>Neo Desk</span>
          <span className="muted">File</span>
          <span className="muted">Edit</span>
          <span className="muted">View</span>
          <span className="muted">Help</span>
        </div>
        <main className="login">
          <p className="eyebrow">Agents</p>
          <h1>登录 Desk</h1>
          <p className="muted">和 Web 共用控制面。布局按 Cursor Agents 三栏来。</p>
          <label>
            账号
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
          </label>
          <label>
            密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </label>
          {authError ? <p className="error">{authError}</p> : null}
          <button type="button" className="primary" disabled={authBusy} onClick={() => void login()}>
            {authBusy ? "登录中…" : "Continue"}
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="menubar">
        <span className="brand">Neo Desk</span>
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span>Help</span>
        <strong className="title">{current ? preview(current.prompt, 40) : "New agent"}</strong>
      </div>
      <div className="columns">
        <aside className="left">
          <button type="button" className="new-chat" onClick={newChat}>
            + New chat
          </button>
          <nav>
            <button type="button" className={nav === "search" ? "on" : ""} onClick={() => setNav("search")}>
              Search
            </button>
            <button type="button" className={nav === "automations" ? "on" : ""} onClick={() => setNav("automations")}>
              Automations
            </button>
            <button type="button" className={nav === "chats" ? "on" : ""} onClick={() => setNav("chats")}>
              Agents
            </button>
          </nav>
          {nav === "search" ? (
            <input className="search" value={query} placeholder="Search agents" onChange={(event) => setQuery(event.target.value)} />
          ) : null}
          <p className="section">Repositories</p>
          <div className="repo-pill">{repoLabel(repo)}</div>
          <ul className="chats">
            {(nav === "automations" ? [] : filtered).map((run) => (
              <li key={run.id}>
                <button type="button" className={run.id === runId ? "on" : ""} onClick={() => void openRun(run.id)}>
                  <strong>{preview(run.prompt, 36)}</strong>
                  <em>
                    {run.executionTarget?.loop === "desk" ? "This Computer" : "Cloud"} · {run.status}
                  </em>
                </button>
              </li>
            ))}
          </ul>
          {nav === "automations" ? (
            <ul className="chats">
              {automations.map((item) => (
                <li key={item.id}>
                  <button type="button">
                    <strong>{item.name || preview(item.prompt, 36)}</strong>
                    <em>{item.enabled ? "On" : "Off"} · {item.schedule.kind}</em>
                  </button>
                </li>
              ))}
              {automations.length === 0 ? <li className="muted pad">还没有定时任务</li> : null}
            </ul>
          ) : null}
          <div className="left-foot">
            <div className="avatar">{initials(user)}</div>
            <div>
              <strong>{user}</strong>
              <em>Desk · {canRunLocal ? "This Computer ready" : "Cloud only"}</em>
            </div>
          </div>
        </aside>
        <main className="center">
          <header className="center-head">
            <h1>{current ? preview(current.prompt, 64) : "Ask the agent to work this repo"}</h1>
            {current ? (
              <p className="muted">
                {current.branchName || "no branch"} · {current.status}
              </p>
            ) : (
              <p className="muted">Follow-ups stay on this thread. Uncommitted files do not follow a handoff.</p>
            )}
          </header>
          <section className="thread">
            {visible.length === 0 ? <p className="empty">Send a task to start this agent.</p> : null}
            {visible.map((message) => (
              <article key={message.id} data-role={message.role}>
                <div className="who">{message.role === "user" ? initials(user) : "N"}</div>
                <div className="bubble">
                  <span>{message.role}</span>
                  <pre>{message.text}</pre>
                </div>
              </article>
            ))}
          </section>
          <footer className="composer">
            <textarea
              value={prompt}
              placeholder={runId ? "Send follow-up" : "Describe a task. Enter to send."}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-row">
              <select value={target.kind} onChange={(event) => applyTarget({ ...target, kind: event.target.value as DeskTarget["kind"] })}>
                <option value="cloud">Cloud</option>
                <option value="desk" disabled={!canRunLocal}>
                  {canRunLocal ? "This Computer" : "This Computer (needs Electron)"}
                </option>
                <option value="remote" disabled>
                  Remote SSH
                </option>
              </select>
              {target.kind === "desk" ? (
                <button
                  type="button"
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
              <select value={mode} onChange={(event) => setMode(event.target.value as "agent" | "ask")}>
                <option value="agent">Agent</option>
                <option value="ask">Ask</option>
              </select>
              <span className="grow" />
              <button type="button" className="primary" disabled={sending || !prompt.trim()} onClick={() => void send()}>
                {sending ? "Sending" : runId ? "Follow-up" : "Send"}
              </button>
            </div>
          </footer>
        </main>
        <aside className="right">
          <p className="section">Project</p>
          <h2>{repoLabel(repo)}</h2>
          <div className="icon-row">
            <button type="button" className={contextTab === "overview" ? "on" : ""} onClick={() => setContextTab("overview")}>
              Overview
            </button>
            <button type="button" className={contextTab === "diff" ? "on" : ""} onClick={() => setContextTab("diff")}>
              Diff
            </button>
            <button type="button" className={contextTab === "files" ? "on" : ""} onClick={() => setContextTab("files")}>
              Files
            </button>
            <button type="button" className={contextTab === "terminal" ? "on" : ""} onClick={() => setContextTab("terminal")}>
              Terminal
            </button>
          </div>
          <p className="section">Pull requests</p>
          <ul className="prs">
            {prs.map((pr) => (
              <li key={`${pr.url}-${pr.number}`}>
                <strong>
                  {pr.number ? `#${pr.number}` : "PR"} {pr.title || pr.branch}
                </strong>
                <em>{pr.draft ? "Draft" : "Open"}</em>
              </li>
            ))}
            {prs.length === 0 ? <li className="muted">No pull requests yet</li> : null}
          </ul>
          {contextTab !== "overview" ? <pre className="context">{contextText || "Loading…"}</pre> : null}
        </aside>
      </div>
      <footer className="statusbar">
        <span>{current?.branchName || "cursor/desk-impl-916f"}</span>
        <span className="dot" />
        <span>{target.kind === "desk" ? "This Computer" : "Cloud"}</span>
        <span className="grow" />
        <span>{current?.status || "idle"}</span>
      </footer>
    </div>
  );
}

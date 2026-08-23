import { applyRunEventsToMessages, displayTranscriptMessages } from "@neo-cloud-agent/contracts/transcript";
import type { RunEvent, TranscriptMessage, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, persistSessionToken, readJson } from "./api";
import { deskBridge, withApiBase, type DeskTarget } from "./desk";

function preview(text: string): string {
  return (text || "新对话").replace(/\s+/g, " ").slice(0, 48);
}

function parseSse(raw: string): RunEvent | null {
  try {
    const event = JSON.parse(raw) as RunEvent;
    return event?.id && event.kind ? event : null;
  } catch {
    return null;
  }
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
  const [runId, setRunId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Run | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState<DeskTarget>({ kind: "cloud" });
  const [folder, setFolder] = useState("");
  const [mode, setMode] = useState<"agent" | "ask">("agent");
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

  const listen = useCallback((id: string) => {
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
  }, [refreshRuns]);

  const openRun = useCallback(
    async (id: string) => {
      setRunId(id);
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
    await refreshRuns();
  }, [refreshRuns]);

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

  const visible = displayTranscriptMessages(messages);

  if (!authed) {
    return (
      <div className="desk-shell">
        <header className="desk-titlebar">
          <span className="desk-wordmark">Neo Desk</span>
          <span className="desk-chip">Agents Window</span>
        </header>
        <main className="desk-login">
          <h1>登录桌面端</h1>
          <p>和 Web 共用控制面账号。这是独立的 Desk UI，不是网页换了个壳。</p>
          <label>
            账号
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {authError ? <p className="desk-error">{authError}</p> : null}
          <button type="button" disabled={authBusy} onClick={() => void login()}>
            {authBusy ? "登录中…" : "进入 Agents"}
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="desk-shell">
      <header className="desk-titlebar">
        <span className="desk-wordmark">Neo Desk</span>
        <span className="desk-chip">Agents</span>
        <span className="desk-spacer" />
        <span className="desk-user">{user}</span>
      </header>
      <div className="desk-body">
        <aside className="desk-sidebar">
          <button
            type="button"
            className="desk-new"
            onClick={() => {
              setRunId(null);
              setCurrent(null);
              setMessages([]);
              sourceRef.current?.close();
            }}
          >
            新对话
          </button>
          <p className="desk-section">最近</p>
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  className={run.id === runId ? "active" : ""}
                  onClick={() => void openRun(run.id)}
                >
                  <strong>{preview(run.prompt)}</strong>
                  <em>
                    {run.executionTarget?.loop === "desk" ? "本机" : "云端"} · {run.status}
                  </em>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <main className="desk-main">
          <div className="desk-session">
            <p className="desk-kicker">{current ? current.status : "新对话"}</p>
            <h1>{current ? preview(current.prompt) : "从本机或云端开一个 Agent"}</h1>
          </div>
          <section className="desk-transcript">
            {visible.length === 0 ? <p className="desk-empty">还没有消息。下面选目标后发送。</p> : null}
            {visible.map((message) => (
              <article key={message.id} data-role={message.role}>
                <span>{message.role}</span>
                <pre>{message.text}</pre>
              </article>
            ))}
          </section>
          <footer className="desk-composer">
            <textarea
              value={prompt}
              placeholder="描述任务。Enter 发送，Shift+Enter 换行。"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="desk-composer-row">
              <label>
                目标
                <select
                  value={target.kind}
                  onChange={(event) => applyTarget({ ...target, kind: event.target.value as DeskTarget["kind"] })}
                >
                  <option value="cloud">Cloud</option>
                  <option value="desk" disabled={!canRunLocal}>
                    {canRunLocal ? "This Computer" : "This Computer（需 Electron）"}
                  </option>
                  <option value="remote" disabled>
                    Remote SSH（P3）
                  </option>
                </select>
              </label>
              {target.kind === "desk" ? (
                <button
                  type="button"
                  onClick={() => {
                    void deskBridge()
                      ?.pickFolder()
                      .then((picked) => {
                        if (picked) {
                          setFolder(picked);
                          applyTarget({ ...target, kind: "desk", folder: picked });
                        }
                      });
                  }}
                >
                  {folder || "选择文件夹…"}
                </button>
              ) : null}
              <label>
                模式
                <select value={mode} onChange={(event) => setMode(event.target.value as "agent" | "ask")}>
                  <option value="agent">Agent</option>
                  <option value="ask">Ask</option>
                </select>
              </label>
              <span className="desk-spacer" />
              <button type="button" className="desk-send" disabled={sending || !prompt.trim()} onClick={() => void send()}>
                {sending ? "发送中" : "发送"}
              </button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

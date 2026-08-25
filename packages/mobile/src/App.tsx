import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyRunEventsToMessages,
  settleTranscriptMessages,
  transcriptGroups,
} from "@neo-cloud-agent/contracts/transcript";
import type { Environment } from "@neo-cloud-agent/contracts/environment";
import type { RunEvent, TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { MobileApiError, MobileClient } from "./api/client";
import { webCredentials, type CredentialStore } from "./api/credentials";
import { detectMobileSource, parseRunIdFromHref } from "./api/source";
import { preview, resolveChatModel, STATUS_LABELS, toolArgPreview, toolDisplayName } from "./format";
import { applyLiveEvents } from "./stream";
import { isComposerClosed, isTerminalTurnEvent, statusFromEventKind } from "./turn";

type Screen = "login" | "list" | "chat" | "settings";

function hashScreen(): { screen: Exclude<Screen, "login">; runId: string | null } {
  if (location.hash === "#/settings") return { screen: "settings", runId: null };
  const runId = parseRunIdFromHref(location.hash || location.href);
  if (runId) return { screen: "chat", runId };
  return { screen: "list", runId: null };
}

export function App({ store = webCredentials() }: { store?: CredentialStore }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [route, setRoute] = useState(hashScreen);
  const [runs, setRuns] = useState<Run[]>([]);
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [envId, setEnvId] = useState("");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [current, setCurrent] = useState<Run | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const lastEventId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const source = useMemo(() => detectMobileSource(navigator.userAgent), []);
  const client = useMemo(() => new MobileClient(apiUrl, token), [apiUrl, token]);

  const persistToken = useCallback(
    async (next: string) => {
      setToken(next);
      if (next) await store.setToken(next);
      else await store.clearToken();
    },
    [store],
  );

  useEffect(() => {
    void (async () => {
      setToken(await store.getToken());
      setApiUrl(await store.getApiUrl());
      setReady(true);
    })();
  }, [store]);

  useEffect(() => {
    const sync = () => setRoute(hashScreen());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const go = (path: string) => {
    location.hash = path;
  };

  const refreshList = useCallback(async () => {
    if (!token) return;
    const [listed, environments, settings] = await Promise.all([
      client.listRuns(),
      client.listEnvironments().catch(() => ({ environments: [] })),
      client.llmSettings().catch(() => null),
    ]);
    setRuns(listed.runs);
    setEnvs(environments.environments);
    if (settings?.model) setModel(resolveChatModel(settings.model));
    if (!envId && environments.environments[0]) setEnvId(environments.environments[0].id);
  }, [client, envId, token]);

  useEffect(() => {
    if (!ready || !token) return;
    void refreshList().catch((error) => {
      if (error instanceof MobileApiError && error.status === 401) void persistToken("");
    });
  }, [ready, token, refreshList, persistToken]);

  const closeStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const listen = useCallback(
    (id: string, after?: string | null) => {
      closeStream();
      const controller = new AbortController();
      abortRef.current = controller;
      const pending: RunEvent[] = [];
      let timer = 0;
      const flush = () => {
        timer = 0;
        const batch = applyLiveEvents([], pending.splice(0));
        if (batch.length === 0) return;
        setMessages((prev) => {
          const next = applyRunEventsToMessages(prev, batch);
          return batch.some((event) => isTerminalTurnEvent(event.kind)) ? settleTranscriptMessages(next) : next;
        });
        for (const event of batch) {
          lastEventId.current = event.id;
          const status = statusFromEventKind(event.kind);
          if (status) {
            setCurrent((run) => (run && run.id === id ? { ...run, status: status as Run["status"] } : run));
          }
        }
      };
      void client
        .streamEvents(
          id,
          (event) => {
            pending.push(event);
            if (!timer) timer = window.setTimeout(flush, 16);
          },
          { after: after ?? lastEventId.current, signal: controller.signal },
        )
        .catch(() => {
          if (!controller.signal.aborted) {
            window.setTimeout(() => listen(id, lastEventId.current), 800);
          }
        });
    },
    [client, closeStream],
  );

  const openRun = useCallback(
    async (id: string) => {
      const [run, transcript] = await Promise.all([client.getRun(id), client.transcript(id)]);
      setCurrent(run);
      setMessages(transcript.snapshot.messages);
      lastEventId.current = transcript.snapshot.lastEventId;
      listen(id, transcript.snapshot.lastEventId);
      go(`/runs/${id}`);
    },
    [client, listen],
  );

  useEffect(() => {
    if (route.screen === "chat" && route.runId && token && current?.id !== route.runId) {
      void openRun(route.runId).catch(() => go("/"));
    }
    if (route.screen !== "chat") closeStream();
  }, [closeStream, current?.id, openRun, route.runId, route.screen, token]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) closeStream();
      else if (route.screen === "chat" && route.runId) listen(route.runId, lastEventId.current);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [closeStream, listen, route.runId, route.screen]);

  const login = async () => {
    setBusy(true);
    setAuthError("");
    try {
      const next = new MobileClient(apiUrl, "");
      const session = await next.login(email.trim(), password);
      await persistToken(session.token);
      setPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = prompt.trim();
    if (!text || sending) return;
    setSending(true);
    setPrompt("");
    try {
      if (!current) {
        const created = await client.createRun({
          prompt: text,
          repoUrls: [],
          envId: envId || undefined,
          source,
          model: resolveChatModel(model),
          target: { loop: "cloud", tools: "cloud" },
        });
        setRuns((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        await openRun(created.id);
        return;
      }
      await client.followUp(current.id, { text });
    } catch (error) {
      setPrompt(text);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "setup",
          text: error instanceof Error ? error.message : "发送失败",
          createdAt: new Date().toISOString(),
          kind: "run.error",
          level: "error",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  if (!ready) return <div className="auth"><p>正在进入…</p></div>;

  if (!token) {
    return (
      <div className="auth">
        <form
          className="auth-card"
          onSubmit={(event) => {
            event.preventDefault();
            void login();
          }}
        >
          <h1>Neo</h1>
          <p>手机端只打云端 /v1，不在本机跑 Agent。</p>
          <label>
            控制面地址
            <input value={apiUrl} placeholder="留空则走本机代理" onChange={(event) => setApiUrl(event.target.value)} />
          </label>
          <label>
            账号
            <input value={email} autoComplete="username" placeholder="admin" onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            密码
            <input type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
          </label>
          {authError ? <p className="error">{authError}</p> : null}
          <button
            className="primary"
            type="submit"
            disabled={busy || !email.trim() || !password}
            onClick={() => void store.setApiUrl(apiUrl)}
          >
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    );
  }

  if (route.screen === "settings") {
    return (
      <div className="app">
        <header className="topbar">
          <button className="ghost" type="button" onClick={() => go("/")}>返回</button>
          <h1>设置</h1>
        </header>
        <div className="auth-card" style={{ margin: 16 }}>
          <label>
            控制面地址
            <input
              value={apiUrl}
              onChange={(event) => setApiUrl(event.target.value)}
              onBlur={() => void store.setApiUrl(apiUrl)}
            />
          </label>
          <p className="hint">推送在原生 App 登记设备后，走同一套 idle / error / PR 通知。</p>
          <button
            className="primary"
            type="button"
            onClick={() => {
              void client.logout().catch(() => undefined);
              void persistToken("");
              go("/");
            }}
          >
            退出登录
          </button>
        </div>
      </div>
    );
  }

  if (route.screen === "chat") {
    const locked = isComposerClosed(current?.status);
    return (
      <div className="app">
        <header className="topbar">
          <button className="ghost" type="button" onClick={() => go("/")}>列表</button>
          <h2>{preview(current?.prompt ?? "对话")}</h2>
          <span className="status">{STATUS_LABELS[current?.status ?? ""] ?? current?.status}</span>
        </header>
        <div className="transcript" ref={transcriptRef}>
          {messages.length === 0 ? <p className="empty">还没有消息。</p> : null}
          {messages.map((message) => (
            <article key={message.id} className={`bubble ${message.role}`}>
              {transcriptGroups(message).map((group, index) =>
                group.type === "text" ? (
                  <p key={`${message.id}-t${index}`}>{group.text}</p>
                ) : (
                  <div key={`${message.id}-g${index}`}>
                    {group.tools.map((tool) => (
                      <div key={tool.id ?? tool.name} className={`tool${tool.isError ? " err" : tool.status === "running" ? " run" : ""}`}>
                        <b>
                          {tool.status === "running" ? "…" : tool.isError ? "✗" : "✓"} {toolDisplayName(tool)}
                        </b>
                        {toolArgPreview(tool.args) ? <span className="cmd">{toolArgPreview(tool.args)}</span> : null}
                        {tool.output ? <pre>{tool.output}</pre> : null}
                      </div>
                    ))}
                  </div>
                ),
              )}
            </article>
          ))}
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            value={prompt}
            disabled={locked}
            placeholder={locked ? "对话已归档。" : "描述任务，点发送。"}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className="composer-row">
            {current ? (
              <button className="ghost" type="button" disabled={!current || current.status !== "RUNNING"} onClick={() => void client.abort(current.id)}>
                停止
              </button>
            ) : null}
            <button className="primary" type="submit" disabled={locked || sending || !prompt.trim()}>
              {sending ? "发送中…" : "发送"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>对话</h1>
        <button className="ghost" type="button" onClick={() => go("/settings")}>设置</button>
      </header>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          setCurrent(null);
          setMessages([]);
          void send();
        }}
      >
        <textarea value={prompt} placeholder="新任务。先选环境，再发送。" onChange={(event) => setPrompt(event.target.value)} />
        <div className="composer-row">
          <select value={envId} onChange={(event) => setEnvId(event.target.value)}>
            <option value="">选择环境</option>
            {envs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="deepseek-v4-flash">Flash</option>
            <option value="deepseek-v4-pro">Pro</option>
          </select>
          <button className="primary" type="submit" disabled={sending || !prompt.trim() || !envId}>
            开始
          </button>
        </div>
      </form>
      <div className="list">
        {runs.length === 0 ? <p className="empty">还没有对话。</p> : null}
        {runs.map((run) => (
          <button key={run.id} className="run-row" type="button" onClick={() => void openRun(run.id)}>
            <b>{preview(run.prompt)}</b>
            <span>
              {STATUS_LABELS[run.status] ?? run.status} · {run.source}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { nextHistoryIndex, termKeyAction, termKeyBytes } from "@neo-cloud-agent/ui/term";
import {
  applyTermChunk,
  createTermScreen,
  type TermScreen,
} from "@neo-cloud-agent/ui/term-render";
import {
  closeWorkspaceTerm,
  ensureWorkspaceTerms,
  openWorkspaceTerm,
  subscribeWorkspaceTerm,
  writeWorkspaceTerm,
  type WorkspaceTermInfo,
} from "../workspace-term.js";

type Log = { name: string; content?: string };

type SessionState = {
  info: WorkspaceTermInfo;
  screen: TermScreen;
  draft: string;
  history: string[];
  historyAt: number;
  alive: boolean;
};

type Props = {
  open: boolean;
  token: string;
  runId: string | null;
  setupLoading: boolean;
  setupError: string;
  setupLogs: Log[];
};

export function TerminalPanel({ open, token, runId, setupLoading, setupError, setupLogs }: Props) {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [activeId, setActiveId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [focused, setFocused] = useState(false);
  const outRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  const writes = useRef(Promise.resolve());
  const unsubs = useRef(new Map<string, () => void>());
  const active = sessions.find((item) => item.info.id === activeId) ?? sessions[0];
  const pty = active?.info.pty !== false;

  const adopt = useCallback(
    (info: WorkspaceTermInfo) => {
      setSessions((prev) => {
        if (prev.some((item) => item.info.id === info.id)) {
          return prev;
        }
        return [
          ...prev,
          {
            info,
            screen: createTermScreen(),
            draft: "",
            history: [],
            historyAt: -1,
            alive: info.alive !== false,
          },
        ];
      });
      setActiveId((cur) => cur || info.id);
      if (unsubs.current.has(info.id) || !runId) {
        return;
      }
      const stop = subscribeWorkspaceTerm(token, runId, info.id, (event) => {
        if (event.type === "data") {
          setSessions((prev) =>
            prev.map((item) =>
              item.info.id === info.id ? { ...item, screen: applyTermChunk(item.screen, event.chunk) } : item,
            ),
          );
          return;
        }
        if (event.type === "exit") {
          setSessions((prev) =>
            prev.map((item) =>
              item.info.id === info.id
                ? { ...item, alive: false, screen: applyTermChunk(item.screen, "\n[已结束]\n") }
                : item,
            ),
          );
        }
      });
      unsubs.current.set(info.id, stop);
    },
    [runId, token],
  );

  const create = useCallback(async () => {
    if (!runId) {
      setError("先发一条消息，等沙箱工作区起来。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      adopt(await openWorkspaceTerm(token, runId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "打不开终端");
    } finally {
      setBusy(false);
    }
  }, [adopt, runId, token]);

  const ensure = useCallback(async () => {
    if (!runId) {
      setError("先发一条消息，等沙箱工作区起来。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (const item of await ensureWorkspaceTerms(token, runId)) {
        adopt(item);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "打不开终端");
    } finally {
      setBusy(false);
    }
  }, [adopt, runId, token]);

  useEffect(() => {
    const current = unsubs.current;
    setSessions([]);
    setActiveId("");
    setError("");
    setAttempted(false);
    for (const stop of current.values()) {
      stop();
    }
    current.clear();
    return () => {
      for (const stop of current.values()) {
        stop();
      }
      current.clear();
    };
  }, [runId, token]);

  useEffect(() => {
    if (!open || !runId || attempted || sessions.length > 0) {
      return;
    }
    setAttempted(true);
    void ensure();
  }, [attempted, ensure, open, runId, sessions.length]);

  useEffect(() => {
    if (outRef.current) {
      outRef.current.scrollTop = outRef.current.scrollHeight;
    }
  }, [active?.screen, active?.draft, activeId]);

  useEffect(() => {
    if (open) {
      ghostRef.current?.focus();
    }
  }, [activeId, open]);

  const patchActive = (fn: (item: SessionState) => SessionState) => {
    setSessions((prev) => prev.map((item) => (item.info.id === activeId ? fn(item) : item)));
  };

  const send = (data: string) => {
    if (!runId || !active) {
      return;
    }
    writes.current = writes.current
      .then(() => writeWorkspaceTerm(token, runId, active.info.id, data))
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "写入失败");
      });
  };

  const closeSession = async (id: string) => {
    if (runId) {
      await closeWorkspaceTerm(token, runId, id).catch(() => undefined);
    }
    unsubs.current.get(id)?.();
    unsubs.current.delete(id);
    setSessions((prev) => {
      const remaining = prev.filter((item) => item.info.id !== id);
      setActiveId((cur) => {
        if (cur !== id) {
          return cur;
        }
        const at = prev.findIndex((item) => item.info.id === id);
        return remaining[Math.min(at, remaining.length - 1)]?.info.id ?? "";
      });
      return remaining;
    });
  };

  if (!open) {
    return null;
  }

  return (
    <section className="terminal-panel" id="run-terminal">
      <header className="term-head">
        <div>
          <strong>沙箱终端</strong>
          <p className="hint">
            {active
              ? pty
                ? `${active.info.shell} · 工作区里可以直接敲命令。Tab 补全路径。`
                : `${active.info.shell} · 工作区里可以直接敲命令。管道 shell，不是完整 PTY。`
              : "打开后进的是沙箱工作区，不是 setup 日志。"}
          </p>
        </div>
        <div className="term-actions">
          {sessions.map((item, index) => (
            <button
              key={item.info.id}
              type="button"
              className={item.info.id === activeId ? "ghost is-on" : "ghost"}
              onClick={() => setActiveId(item.info.id)}
            >
              {item.info.shell} {index + 1}
            </button>
          ))}
          <button type="button" className="ghost" disabled={busy || !runId} onClick={() => void create()}>
            新终端
          </button>
          {active ? (
            <button type="button" className="ghost" onClick={() => void closeSession(active.info.id)}>
              关闭
            </button>
          ) : null}
        </div>
      </header>
      {error ? <p className="setup err">{error}</p> : null}
      {!runId ? <p className="hint">先发一条消息，等沙箱工作区起来再敲命令。</p> : null}
      {busy && sessions.length === 0 ? <p className="hint">正在打开沙箱 shell…</p> : null}
      {active ? (
        <div
          className={`term-shell${focused ? " is-focused" : ""}`}
          ref={outRef}
          onMouseDown={(event) => {
            if (event.target === ghostRef.current) {
              return;
            }
            event.preventDefault();
            ghostRef.current?.focus();
          }}
        >
          <TermPre screen={active.screen} draft={pty ? "" : active.draft} />
          <textarea
            ref={ghostRef}
            className="term-ghost"
            value={pty ? undefined : active.draft}
            defaultValue={pty ? "" : undefined}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="终端输入"
            disabled={!active.alive}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              if (!pty) {
                return;
              }
              const value = event.currentTarget.value;
              event.currentTarget.value = "";
              if (value) {
                send(value);
              }
            }}
            onChange={(event) => {
              if (pty) {
                if (composing.current || Boolean((event.nativeEvent as InputEvent).isComposing)) {
                  return;
                }
                const value = event.target.value;
                event.target.value = "";
                if (value) {
                  send(value);
                }
                return;
              }
              const value = event.target.value;
              patchActive((item) => ({ ...item, draft: value, historyAt: -1 }));
            }}
            onKeyDown={(event) => {
              if (pty) {
                if (event.nativeEvent.isComposing || composing.current) {
                  return;
                }
                const bytes = termKeyBytes({
                  key: event.key,
                  ctrlKey: event.ctrlKey,
                  metaKey: event.metaKey,
                  altKey: event.altKey,
                });
                if (bytes == null) {
                  return;
                }
                if (bytes === "\x03" && window.getSelection()?.toString()) {
                  return;
                }
                event.preventDefault();
                send(bytes);
                return;
              }
              const action = termKeyAction({
                key: event.key,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                composing: event.nativeEvent.isComposing,
              });
              if (action === "ignore") {
                return;
              }
              if (action === "interrupt" && window.getSelection()?.toString()) {
                return;
              }
              event.preventDefault();
              if (action === "submit") {
                send(`${active.draft}\n`);
                const line = active.draft;
                patchActive((item) => ({
                  ...item,
                  draft: "",
                  history: line.trim() ? [...item.history, line] : item.history,
                  historyAt: -1,
                }));
                return;
              }
              if (action === "interrupt") {
                send("\x03");
                return;
              }
              if (action === "clear") {
                patchActive((item) => ({ ...item, screen: createTermScreen() }));
                return;
              }
              const next = nextHistoryIndex(action, active.historyAt, active.history.length);
              patchActive((item) => ({
                ...item,
                historyAt: next,
                draft: next < 0 ? "" : (item.history[next] ?? ""),
              }));
            }}
          />
        </div>
      ) : null}
      <details className="term-setup">
        <summary>Setup 日志</summary>
        {setupLoading ? <p className="hint">正在读取…</p> : null}
        {setupError ? <p className="setup err">{setupError}</p> : null}
        {!setupLoading && !setupError && setupLogs.length === 0 ? <p className="hint">还没有 setup 日志。</p> : null}
        {setupLogs.map((log) => (
          <article key={log.name}>
            <p className="eyebrow">{log.name}</p>
            <pre className="terminal-log">{log.content || "（空）"}</pre>
          </article>
        ))}
      </details>
    </section>
  );
}

function TermPre({ screen, draft }: { screen: TermScreen; draft: string }) {
  const nodes: ReactNode[] = [];
  for (let i = 0; i < screen.lines.length; i += 1) {
    const line = `${screen.lines[i] ?? ""}${i === screen.lines.length - 1 ? draft : ""}`;
    if (i > 0) {
      nodes.push("\n");
    }
    if (i === screen.row) {
      const col = Math.min(screen.col + (i === screen.lines.length - 1 ? draft.length : 0), line.length);
      nodes.push(line.slice(0, col));
      nodes.push(<span key={`caret-${i}`} className="term-caret" aria-hidden="true" />);
      nodes.push(line.slice(col));
    } else {
      nodes.push(line);
    }
  }
  return <pre>{nodes}</pre>;
}

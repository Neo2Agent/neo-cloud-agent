import { useCallback, useEffect, useRef, useState } from "react";
import { api, readJson } from "./api";
import { deskBridge, STALE_DESK_HINT, type LocalFsListing } from "./desk";
import { IconClose, IconComputer, IconSync } from "./icons";

export type SidePanelTab = "files" | "terminal";

type Props = {
  tab: SidePanelTab;
  onTab: (tab: SidePanelTab) => void;
  onClose: () => void;
  /** Local folder when the run executes here, else empty. */
  folder: string;
  /** Cloud runs read their workspace through the control plane instead. */
  token: string;
  runId: string | null;
  local: boolean;
  refreshKey?: number;
};

export function SidePanel({ tab, onTab, onClose, folder, token, runId, local, refreshKey = 0 }: Props) {
  return (
    <aside className="side-panel">
      <header className="side-panel-head">
        <div className="side-panel-tabs">
          <button type="button" className={tab === "files" ? "on" : ""} onClick={() => onTab("files")}>
            Files
          </button>
          <button type="button" className={tab === "terminal" ? "on" : ""} onClick={() => onTab("terminal")}>
            {local ? "Terminal" : "输出"}
          </button>
        </div>
        <button type="button" className="icon-btn" aria-label="收起右侧栏" onClick={onClose}>
          <IconClose />
        </button>
      </header>
      {tab === "files" ? (
        <FilesTab folder={folder} token={token} runId={runId} local={local} refreshKey={refreshKey} />
      ) : local ? (
        <TerminalTab folder={folder} />
      ) : (
        <CloudOutputTab token={token} runId={runId} refreshKey={refreshKey} />
      )}
    </aside>
  );
}

type CloudListing = {
  path: string;
  type: "file" | "dir";
  entries?: Array<{ name: string; path: string; type: "file" | "dir" }>;
  content?: string;
  truncated?: boolean;
};

function FilesTab({
  folder,
  token,
  runId,
  local,
  refreshKey,
}: {
  folder: string;
  token: string;
  runId: string | null;
  local: boolean;
  refreshKey: number;
}) {
  const [rel, setRel] = useState("");
  const [listing, setListing] = useState<LocalFsListing | CloudListing | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setRel("");
  }, [folder, runId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError("");
      if (local) {
        if (!folder) {
          setListing(null);
          return;
        }
        const listDir = deskBridge()?.listDir;
        if (!listDir) {
          setError(STALE_DESK_HINT);
          return;
        }
        const next = await listDir({ folder, path: rel, content: Boolean(rel) });
        if (cancelled) return;
        if (next.error) {
          setError(next.error);
          return;
        }
        setListing(next);
        return;
      }
      if (!runId) {
        setListing(null);
        return;
      }
      const response = await api(token, `/v1/runs/${runId}/fs?path=${encodeURIComponent(rel)}&content=${rel ? "1" : "0"}`);
      const body = await readJson<CloudListing & { error?: string }>(response);
      if (cancelled) return;
      if (!response.ok) {
        setError(body.error || "读取工作区失败");
        return;
      }
      setListing(body);
    })();
    return () => {
      cancelled = true;
    };
  }, [folder, local, refreshKey, rel, runId, tick, token]);

  if (local && !folder) {
    return (
      <div className="side-panel-body">
        <p className="hint">先在 composer 上选 This Computer 并授权一个文件夹，这里才会显示本机文件。</p>
      </div>
    );
  }
  if (!local && !runId) {
    return (
      <div className="side-panel-body">
        <p className="hint">发送任务后可以浏览云端工作区。</p>
      </div>
    );
  }

  const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  const isFile = listing?.type === "file";

  return (
    <div className="side-panel-body">
      <div className="side-panel-bar">
        {local ? <IconComputer size={12} /> : null}
        <span className="side-panel-path" title={local ? folder : undefined}>
          {rel || (local ? folder.split(/[\\/]/).pop() : "工作区")}
        </span>
        {rel ? (
          <button type="button" className="ghost" onClick={() => setRel(parent)}>
            上级
          </button>
        ) : null}
        <button type="button" className="icon-btn" aria-label="刷新" onClick={() => setTick((n) => n + 1)}>
          <IconSync />
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {isFile ? (
        <>
          {local ? (
            <button type="button" className="ghost side-panel-open" onClick={() => void deskBridge()?.openPath(`${folder}/${rel}`)}>
              用系统编辑器打开
            </button>
          ) : null}
          <pre className="side-panel-file">
            {listing?.content ?? ""}
            {listing?.truncated ? "\n…（已截断）" : ""}
          </pre>
        </>
      ) : (
        <ul className="side-panel-tree">
          {(listing?.entries ?? []).map((entry) => (
            <li key={entry.path}>
              <button type="button" onClick={() => setRel(entry.path)}>
                <span className="side-panel-kind">{entry.type === "dir" ? "▸" : "·"}</span>
                {entry.name}
              </button>
            </li>
          ))}
          {listing && (listing.entries ?? []).length === 0 ? <li className="hint">空文件夹。</li> : null}
        </ul>
      )}
    </div>
  );
}

function TerminalTab({ folder }: { folder: string }) {
  const [sessions, setSessions] = useState<Array<{ id: string; label: string }>>([]);
  const [activeId, setActiveId] = useState("");
  const [output, setOutput] = useState<Record<string, string>>({});
  const [line, setLine] = useState("");
  const [error, setError] = useState("");
  const outRef = useRef<HTMLPreElement | null>(null);

  const open = useCallback(async () => {
    const termOpen = deskBridge()?.termOpen;
    if (!folder) return;
    if (!termOpen) {
      setError(STALE_DESK_HINT);
      return;
    }
    const created = await termOpen(folder);
    if (created.error || !created.id) {
      setError(created.error || "打不开终端");
      return;
    }
    const id = created.id;
    setSessions((prev) => [...prev, { id, label: `Terminal ${prev.length + 1}` }]);
    setActiveId(id);
    setOutput((prev) => ({ ...prev, [id]: "" }));
  }, [folder]);

  useEffect(() => {
    const bridge = deskBridge();
    if (!bridge?.onTermData) return;
    const offData = bridge.onTermData(({ id, chunk }) => {
      setOutput((prev) => ({ ...prev, [id]: `${prev[id] ?? ""}${chunk}`.slice(-60_000) }));
    });
    const offExit = bridge.onTermExit?.(({ id }) => {
      setOutput((prev) => ({ ...prev, [id]: `${prev[id] ?? ""}\n[已结束]\n` }));
    });
    return () => {
      offData?.();
      offExit?.();
    };
  }, []);

  useEffect(() => {
    if (folder && sessions.length === 0) {
      void open();
    }
  }, [folder, open, sessions.length]);

  useEffect(() => {
    if (outRef.current) {
      outRef.current.scrollTop = outRef.current.scrollHeight;
    }
  }, [output, activeId]);

  if (!folder) {
    return (
      <div className="side-panel-body">
        <p className="hint">本机终端需要先选一个文件夹。</p>
      </div>
    );
  }

  return (
    <div className="side-panel-body term">
      <div className="side-panel-bar">
        {sessions.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`term-tab${item.id === activeId ? " on" : ""}`}
            onClick={() => setActiveId(item.id)}
          >
            {item.label}
          </button>
        ))}
        <button type="button" className="icon-btn" aria-label="新终端" onClick={() => void open()}>
          +
        </button>
        {activeId ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭终端"
            onClick={() => {
              void deskBridge()?.termClose?.(activeId);
              setSessions((prev) => prev.filter((item) => item.id !== activeId));
              setActiveId((prev) => (prev === activeId ? "" : prev));
            }}
          >
            <IconClose />
          </button>
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
      <pre className="term-out" ref={outRef}>
        {output[activeId] ?? ""}
      </pre>
      <form
        className="term-input"
        onSubmit={(event) => {
          event.preventDefault();
          if (!activeId) return;
          void deskBridge()?.termWrite?.(activeId, `${line}\n`);
          setOutput((prev) => ({ ...prev, [activeId]: `${prev[activeId] ?? ""}${line}\n` }));
          setLine("");
        }}
      >
        <input
          value={line}
          onChange={(event) => setLine(event.target.value)}
          placeholder={`在 ${folder.split(/[\\/]/).pop()} 里执行…`}
          spellCheck={false}
        />
      </form>
    </div>
  );
}

/**
 * Cloud runs get command output, not an interactive shell. Typing into a VM
 * would need a separate channel into the box, which this release does not build.
 */
function CloudOutputTab({ token, runId, refreshKey }: { token: string; runId: string | null; refreshKey: number }) {
  const [logs, setLogs] = useState<Array<{ name: string; content?: string }>>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!runId) {
      setLogs([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const response = await api(token, `/v1/runs/${runId}/diagnostics`);
      const body = await readJson<{ logs?: Array<{ name: string; content?: string }>; error?: string }>(response);
      if (cancelled) return;
      if (!response.ok) {
        setError(body.error || "读取日志失败");
        return;
      }
      setError("");
      setLogs(body.logs ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, runId, token]);

  if (!runId) {
    return (
      <div className="side-panel-body">
        <p className="hint">发送任务后可以看云端输出。</p>
      </div>
    );
  }

  return (
    <div className="side-panel-body">
      <p className="hint">云端对话看的是命令输出和 setup 日志。要自己敲命令，请把对话开在 This Computer。</p>
      {error ? <p className="error">{error}</p> : null}
      {logs.length === 0 && !error ? <p className="hint">还没有输出。</p> : null}
      {logs.map((log) => (
        <article key={log.name}>
          <p className="eyebrow">{log.name}</p>
          <pre className="term-out">{log.content || "（空）"}</pre>
        </article>
      ))}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { fileKind, nextUntitledName, sortFsEntries } from "../src/file-kind";
import { nextHistoryIndex, termKeyAction } from "../src/term-keys";
import { api, readJson } from "./api";
import { deskBridge, STALE_DESK_HINT, type LocalFsListing } from "./desk";
import { FileGlyph } from "./FileGlyph";
import { IconClose, IconExpand, IconFile, IconPanelRight, IconPlus, IconRailDock, IconSync, IconTerminal } from "./icons";

export type SidePanelTab = "home" | "files" | "terminal";

type FsEntry = { name: string; path: string; type: "file" | "dir" };

type Props = {
  tab: SidePanelTab;
  onTab: (tab: SidePanelTab) => void;
  onClose: () => void;
  folder: string;
  token: string;
  runId: string | null;
  local: boolean;
  refreshKey?: number;
};

export function SidePanel({ tab, onTab, onClose, folder, token, runId, local, refreshKey = 0 }: Props) {
  const [maxed, setMaxed] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [filesTab, setFilesTab] = useState(tab === "files");
  const term = useTerminalSessions(folder);
  const page =
    tab === "files" && filesTab ? "files" : tab === "terminal" && term.sessions.length > 0 ? "terminal" : filesTab ? "files" : "home";
  const showRail = page !== "home" && railOpen;

  const openTerminal = () => {
    void term.open();
    onTab("terminal");
  };

  const openFiles = () => {
    setFilesTab(true);
    onTab("files");
  };

  const closeFiles = () => {
    setFilesTab(false);
    if (term.activeId || term.sessions[0]) {
      if (!term.activeId && term.sessions[0]) term.setActiveId(term.sessions[0].id);
      onTab("terminal");
      return;
    }
    onTab("home");
  };

  const closeSession = (id: string) => {
    const last = term.sessions.length <= 1 && term.sessions.some((item) => item.id === id);
    term.close(id);
    if (last) onTab(filesTab ? "files" : "home");
  };

  return (
    <aside className={`side-panel workbench${maxed ? " is-max" : ""}${showRail ? " has-rail" : ""}`}>
      <header className="wb-chrome">
        <WorkbenchTabs
          sessions={term.sessions}
          activeId={page === "terminal" ? term.activeId : ""}
          filesOn={page === "files"}
          filesTab={filesTab}
          onSelectSession={(id) => {
            term.setActiveId(id);
            onTab("terminal");
          }}
          onCloseSession={closeSession}
          onFiles={openFiles}
          onCloseFiles={closeFiles}
          onNew={openTerminal}
        />
        <ChromeTools onMax={() => setMaxed((cur) => !cur)} onStow={onClose} />
      </header>
      {page === "home" ? (
        <div className="wb-home">
          <button type="button" className="wb-tile" onClick={openTerminal}>
            <IconTerminal size={22} />
            <span>{local ? "Terminal" : "输出"}</span>
          </button>
          <button type="button" className="wb-tile" onClick={openFiles}>
            <IconFile size={22} />
            <span>File</span>
          </button>
        </div>
      ) : page === "files" ? (
        <FilesView
          folder={folder}
          token={token}
          runId={runId}
          local={local}
          refreshKey={refreshKey}
          railOpen={railOpen}
          onToggleRail={() => setRailOpen((cur) => !cur)}
        />
      ) : local ? (
        <TerminalView
          term={term}
          railOpen={railOpen}
          onToggleRail={() => setRailOpen((cur) => !cur)}
          onCloseSession={closeSession}
        />
      ) : (
        <CloudOutputTab token={token} runId={runId} refreshKey={refreshKey} />
      )}
    </aside>
  );
}

function useTerminalSessions(folder: string) {
  const [sessions, setSessions] = useState<Array<{ id: string; label: string }>>([]);
  const [activeId, setActiveId] = useState("");
  const [output, setOutput] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, string[]>>({});
  const [historyAt, setHistoryAt] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const label = defaultTermLabel();

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
    setSessions((prev) => [...prev, { id, label: prev.length === 0 ? label : `${label} ${prev.length + 1}` }]);
    setActiveId(id);
    setOutput((prev) => ({ ...prev, [id]: "" }));
  }, [folder, label]);

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

  const close = (id: string) => {
    void deskBridge()?.termClose?.(id);
    setSessions((prev) => {
      const remaining = prev.filter((item) => item.id !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const at = prev.findIndex((item) => item.id === id);
        return remaining[Math.min(at, remaining.length - 1)]?.id ?? "";
      });
      return remaining;
    });
  };

  return { sessions, activeId, setActiveId, output, setOutput, drafts, setDrafts, history, setHistory, historyAt, setHistoryAt, error, open, close };
}

function defaultTermLabel(): string {
  return /windows/i.test(navigator.userAgent) ? "cmd" : "bash";
}

function ChromeTools({ onMax, onStow }: { onMax: () => void; onStow: () => void }) {
  return (
    <div className="wb-chrome-end">
      <button type="button" className="icon-btn" aria-label="加宽工作区" title="加宽工作区" onClick={onMax}>
        <IconExpand size={14} />
      </button>
      <button type="button" className="icon-btn" aria-label="收起右侧栏" title="收起右侧栏" onClick={onStow}>
        <IconPanelRight size={14} />
      </button>
    </div>
  );
}

function PaneBar({ title, railOpen, onToggle }: { title: string; railOpen: boolean; onToggle: () => void }) {
  return (
    <div className="wb-pane-bar">
      <span className="wb-pane-title">{title}</span>
      <button
        type="button"
        className="wb-pane-open"
        aria-label={railOpen ? "收起附栏" : "打开附栏"}
        title={railOpen ? "收起附栏" : "打开附栏"}
        onClick={onToggle}
      >
        <IconRailDock size={14} />
      </button>
    </div>
  );
}

function WorkbenchTabs({
  sessions,
  activeId,
  filesOn,
  filesTab,
  onSelectSession,
  onCloseSession,
  onFiles,
  onCloseFiles,
  onNew,
}: {
  sessions: Array<{ id: string; label: string }>;
  activeId: string;
  filesOn: boolean;
  filesTab: boolean;
  onSelectSession: (id: string) => void;
  onCloseSession: (id: string) => void;
  onFiles: () => void;
  onCloseFiles: () => void;
  onNew: () => void;
}) {
  return (
    <div className="wb-tabs">
      {filesTab ? (
        <div className={`wb-tab${filesOn ? " on" : ""}`}>
          <button type="button" className="wb-tab-main" onClick={onFiles}>
            <IconFile size={13} />
            <span className="wb-tab-label">Files</span>
          </button>
          <button
            type="button"
            className="wb-tab-close is-shown"
            aria-label="关闭 Files"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCloseFiles();
            }}
          >
            <IconClose size={10} />
          </button>
        </div>
      ) : null}
      {sessions.map((item) => (
        <div key={item.id} className={`wb-tab${item.id === activeId && !filesOn ? " on" : ""}`}>
          <button type="button" className="wb-tab-main" onClick={() => onSelectSession(item.id)}>
            <IconTerminal size={13} />
            <span className="wb-tab-label">{item.label}</span>
          </button>
          <button type="button" className="wb-tab-close" aria-label={`关闭 ${item.label}`} onClick={() => onCloseSession(item.id)}>
            <IconClose size={10} />
          </button>
        </div>
      ))}
      <button type="button" className="wb-tab-add icon-btn" aria-label="新终端" title="新终端" onClick={onNew}>
        <IconPlus size={14} />
      </button>
    </div>
  );
}

function TerminalView({
  term,
  railOpen,
  onToggleRail,
  onCloseSession,
}: {
  term: ReturnType<typeof useTerminalSessions>;
  railOpen: boolean;
  onToggleRail: () => void;
  onCloseSession: (id: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const outRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLTextAreaElement | null>(null);
  const draft = term.drafts[term.activeId] ?? "";

  useEffect(() => {
    if (outRef.current) {
      outRef.current.scrollTop = outRef.current.scrollHeight;
    }
  }, [term.output, draft, term.activeId]);

  useEffect(() => {
    ghostRef.current?.focus();
  }, [term.activeId]);

  const focusTerm = () => ghostRef.current?.focus();

  return (
    <>
      <div className="wb-subbar">
        <PaneBar
          title={term.sessions.find((item) => item.id === term.activeId)?.label ?? "Terminal"}
          railOpen={railOpen}
          onToggle={onToggleRail}
        />
      </div>
      <div className="wb-body">
        <div className="wb-main">
          {term.error ? <p className="error">{term.error}</p> : null}
          {!term.activeId ? (
            <p className="wb-empty">本机终端需要先选一个文件夹。</p>
          ) : (
              <div
                className={`term-out is-flat${focused ? " is-focused" : ""}`}
                ref={outRef}
                onMouseDown={(event) => {
                  if (event.target === ghostRef.current) return;
                  event.preventDefault();
                  focusTerm();
                }}
              >
                <pre>
                  {(term.output[term.activeId] ?? "") + draft}
                  <span className="term-caret" aria-hidden="true" />
                </pre>
                <textarea
                  ref={ghostRef}
                  className="term-ghost"
                  value={draft}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-label="终端输入"
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onChange={(event) => {
                    const id = term.activeId;
                    const value = event.target.value;
                    term.setDrafts((prev) => ({ ...prev, [id]: value }));
                    term.setHistoryAt((prev) => ({ ...prev, [id]: -1 }));
                  }}
                  onKeyDown={(event) => {
                    const id = term.activeId;
                    const action = termKeyAction({
                      key: event.key,
                      ctrlKey: event.ctrlKey,
                      metaKey: event.metaKey,
                      altKey: event.altKey,
                      composing: event.nativeEvent.isComposing,
                    });
                    if (action === "ignore") return;
                    if (action === "interrupt" && window.getSelection()?.toString()) return;
                    event.preventDefault();
                    if (action === "submit") {
                      void deskBridge()?.termWrite?.(id, `${draft}\n`);
                      if (draft.trim()) {
                        term.setHistory((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), draft] }));
                      }
                      term.setOutput((prev) => ({ ...prev, [id]: `${prev[id] ?? ""}${draft}\n` }));
                      term.setDrafts((prev) => ({ ...prev, [id]: "" }));
                      term.setHistoryAt((prev) => ({ ...prev, [id]: -1 }));
                      return;
                    }
                    if (action === "interrupt") {
                      void deskBridge()?.termWrite?.(id, "\x03");
                      return;
                    }
                    if (action === "clear") {
                      term.setOutput((prev) => ({ ...prev, [id]: "" }));
                      return;
                    }
                    const items = term.history[id] ?? [];
                    const next = nextHistoryIndex(action, term.historyAt[id] ?? -1, items.length);
                    term.setHistoryAt((prev) => ({ ...prev, [id]: next }));
                    term.setDrafts((prev) => ({ ...prev, [id]: next < 0 ? "" : (items[next] ?? "") }));
                  }}
                />
              </div>
          )}
        </div>
        {railOpen ? (
          <aside className="wb-rail">
            <div className="wb-rail-head">
              <span>
                {term.sessions.length} Terminal{term.sessions.length === 1 ? "" : "s"}
              </span>
              <button type="button" className="icon-btn" aria-label="新终端" onClick={() => void term.open()}>
                <IconPlus size={14} />
              </button>
            </div>
            <ul className="wb-rail-list">
              {term.sessions.map((item) => (
                <li key={item.id} className={item.id === term.activeId ? "on" : ""}>
                  <button type="button" className="wb-rail-item" onClick={() => term.setActiveId(item.id)}>
                    <IconTerminal size={13} />
                    <span className="wb-rail-name">{item.label}</span>
                  </button>
                  <button type="button" className="wb-rail-close" aria-label={`关闭 ${item.label}`} onClick={() => onCloseSession(item.id)}>
                    <IconClose size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </>
  );
}

function FilesView({
  folder,
  token,
  runId,
  local,
  refreshKey,
  railOpen,
  onToggleRail,
}: {
  folder: string;
  token: string;
  runId: string | null;
  local: boolean;
  refreshKey: number;
  railOpen: boolean;
  onToggleRail: () => void;
}) {
  const [tree, setTree] = useState<Record<string, FsEntry[]>>({});
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({ "": true });
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<{ path: string; content: string; truncated?: boolean } | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("untitled.md");
  const rootName = local ? folder.split(/[\\/]/).pop() || "工作区" : "工作区";

  const loadDir = useCallback(
    async (path: string) => {
      const listing = await readListing({ folder, token, runId, local, path, content: false });
      if (listing.error) {
        setError(listing.error);
        return;
      }
      setError("");
      setTree((prev) => ({ ...prev, [path]: sortFsEntries(listing.entries ?? []) }));
    },
    [folder, local, runId, token],
  );

  useEffect(() => {
    setSelected("");
    setPreview(null);
    setTree({});
    setOpenDirs({ "": true });
  }, [folder, runId]);

  useEffect(() => {
    if ((local && !folder) || (!local && !runId)) return;
    void loadDir("");
  }, [folder, local, loadDir, refreshKey, runId, tick]);

  const openFile = async (path: string) => {
    setSelected(path);
    const listing = await readListing({ folder, token, runId, local, path, content: true });
    if (listing.error) {
      setError(listing.error);
      return;
    }
    setError("");
    setPreview({ path, content: listing.content ?? "", truncated: listing.truncated });
  };

  const toggleDir = async (path: string) => {
    const next = !openDirs[path];
    setOpenDirs((prev) => ({ ...prev, [path]: next }));
    if (next && !tree[path]) {
      await loadDir(path);
    }
  };

  const ready = local ? Boolean(folder) : Boolean(runId);

  const startCreate = () => {
    setNewName(nextUntitledName(tree[""] ?? []));
    setCreating(true);
  };

  const createFile = async () => {
    const writeFile = deskBridge()?.writeFile;
    if (!local || !folder) {
      return;
    }
    if (!writeFile) {
      setError(STALE_DESK_HINT);
      return;
    }
    const created = await writeFile({ folder, path: newName.trim() });
    if (created.error || !created.path) {
      setError(created.error || "创建失败");
      return;
    }
    setCreating(false);
    setTick((n) => n + 1);
    await openFile(created.path);
  };

  return (
    <>
      <div className="wb-subbar">
        <PaneBar title={preview?.path || rootName} railOpen={railOpen} onToggle={onToggleRail} />
      </div>
      <div className="wb-body">
        <div className="wb-main">
          {error ? <p className="error">{error}</p> : null}
          {!ready ? (
            <p className="wb-empty">{local ? "先在 composer 上选一个本机文件夹。" : "发送任务后可以浏览云端工作区。"}</p>
          ) : preview ? (
            <pre className="wb-preview">
              {preview.content}
              {preview.truncated ? "\n…（已截断）" : ""}
            </pre>
          ) : (
            <div className="wb-empty-card">
              <p>从右侧打开文件预览</p>
              {local && folder ? (
                creating ? (
                  <form
                    className="wb-new-file"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void createFile();
                    }}
                  >
                    <input
                      value={newName}
                      autoFocus
                      aria-label="文件名"
                      onChange={(event) => setNewName(event.target.value)}
                    />
                    <button type="submit" className="wb-empty-btn">
                      创建
                    </button>
                    <button type="button" className="wb-empty-btn" onClick={() => setCreating(false)}>
                      取消
                    </button>
                  </form>
                ) : (
                  <button type="button" className="wb-empty-btn" onClick={startCreate}>
                    New File
                  </button>
                )
              ) : null}
            </div>
          )}
        </div>
        {railOpen ? (
          <aside className="wb-rail">
            <div className="wb-rail-head">
              <span title={local ? folder : undefined}>{rootName}</span>
              {local && folder ? (
                <button type="button" className="icon-btn" aria-label="New File" title="New File" onClick={startCreate}>
                  <IconPlus size={14} />
                </button>
              ) : null}
              <button type="button" className="icon-btn" aria-label="刷新" onClick={() => setTick((n) => n + 1)}>
                <IconSync size={13} />
              </button>
            </div>
            {ready ? (
              <FileTree
                path=""
                depth={0}
                tree={tree}
                openDirs={openDirs}
                selected={selected}
                onToggle={toggleDir}
                onFile={openFile}
              />
            ) : (
              <p className="hint">还没有工作区。</p>
            )}
          </aside>
        ) : null}
      </div>
    </>
  );
}

function FileTree({
  path,
  depth,
  tree,
  openDirs,
  selected,
  onToggle,
  onFile,
}: {
  path: string;
  depth: number;
  tree: Record<string, FsEntry[]>;
  openDirs: Record<string, boolean>;
  selected: string;
  onToggle: (path: string) => void;
  onFile: (path: string) => void;
}) {
  const entries = tree[path] ?? [];
  return (
    <ul className="wb-tree" style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      {entries.map((entry) => {
        const kind = fileKind(entry.name, entry.type);
        const open = Boolean(openDirs[entry.path]);
        return (
          <li key={entry.path}>
            <button
              type="button"
              className={`wb-tree-row${selected === entry.path ? " on" : ""}`}
              onClick={() => (entry.type === "dir" ? onToggle(entry.path) : onFile(entry.path))}
            >
              {entry.type === "dir" ? <span className={`wb-chevron${open ? " open" : ""}`}>▸</span> : <span className="wb-chevron gap" />}
              <FileGlyph kind={kind} open={open} />
              <span className="wb-tree-name">{entry.name}</span>
            </button>
            {entry.type === "dir" && open ? (
              <FileTree
                path={entry.path}
                depth={depth + 1}
                tree={tree}
                openDirs={openDirs}
                selected={selected}
                onToggle={onToggle}
                onFile={onFile}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

async function readListing(input: {
  folder: string;
  token: string;
  runId: string | null;
  local: boolean;
  path: string;
  content: boolean;
}): Promise<LocalFsListing & { entries?: FsEntry[]; error?: string }> {
  if (input.local) {
    const listDir = deskBridge()?.listDir;
    if (!listDir) {
      return { root: input.folder, path: input.path, type: "dir", error: STALE_DESK_HINT };
    }
    return listDir({ folder: input.folder, path: input.path, content: input.content });
  }
  if (!input.runId) {
    return { root: "", path: input.path, type: "dir", error: "还没有对话" };
  }
  const response = await api(input.token, `/v1/runs/${input.runId}/fs?path=${encodeURIComponent(input.path)}&content=${input.content ? "1" : "0"}`);
  return readJson<LocalFsListing & { error?: string }>(response);
}

function CloudOutputTab({
  token,
  runId,
  refreshKey,
}: {
  token: string;
  runId: string | null;
  refreshKey: number;
}) {
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

  return (
      <div className="side-panel-body">
        {!runId ? <p className="hint">发送任务后可以看云端输出。</p> : null}
        {runId ? <p className="hint">云端对话看的是命令输出。要自己敲命令，请把对话开在 This Computer。</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {logs.map((log) => (
          <article key={log.name}>
            <p className="eyebrow">{log.name}</p>
            <pre className="wb-preview">{log.content || "（空）"}</pre>
          </article>
        ))}
      </div>
  );
}

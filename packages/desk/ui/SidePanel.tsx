import { useCallback, useEffect, useRef, useState } from "react";
import { applyTermChunk, createTermScreen, termScreenText } from "@neo-cloud-agent/ui/term-render";
import { createTermWriteQueue } from "@neo-cloud-agent/ui/term-write";
import { fileKind, nextUntitledName, sortFsEntries } from "../src/file-kind";
import { nextHistoryIndex, termKeyAction, termKeyBytes } from "../src/term-keys";
import type { ProjectAsset } from "@neo-cloud-agent/contracts/project-asset";
import { api, readJson } from "./api";
import { ArtifactsPane } from "./ArtifactsPane";
import { deskBridge, STALE_DESK_HINT, type LocalFsListing } from "./desk";
import {
  closeWorkspaceTerm,
  ensureWorkspaceTerms,
  openWorkspaceTerm,
  subscribeWorkspaceTerm,
  writeWorkspaceTerm,
} from "./workspace-term";
import { FileGlyph } from "./FileGlyph";
import { IconArtifacts, IconClose, IconExpand, IconFile, IconPanelRight, IconPlus, IconRailDock, IconSync, IconTerminal } from "./icons";
import { IslandButton, IslandCard, IslandInput } from "./island";

export type SidePanelTab = "home" | "files" | "terminal" | "artifacts";

type FsEntry = { name: string; path: string; type: "file" | "dir" };

type Props = {
  tab: SidePanelTab;
  onTab: (tab: SidePanelTab) => void;
  onClose: () => void;
  folder: string;
  token: string;
  runId: string | null;
  projectId?: string | null;
  local: boolean;
  refreshKey?: number;
  onSaved?: (asset: ProjectAsset) => void;
};

export function SidePanel({
  tab,
  onTab,
  onClose,
  folder,
  token,
  runId,
  projectId,
  local,
  refreshKey = 0,
  onSaved,
}: Props) {
  const [maxed, setMaxed] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [filesTab, setFilesTab] = useState(tab === "files");
  const [artifactsTab, setArtifactsTab] = useState(tab === "artifacts");
  const term = useTerminalSessions({ folder, token, runId, local });
  const page =
    tab === "artifacts"
      ? "artifacts"
      : tab === "files" && filesTab
        ? "files"
        : tab === "terminal"
          ? "terminal"
          : filesTab
            ? "files"
            : artifactsTab
              ? "artifacts"
              : "home";
  const showRail = page !== "home" && railOpen;

  const openTerminal = () => {
    void term.ensure();
    onTab("terminal");
  };

  const openFiles = () => {
    setFilesTab(true);
    setArtifactsTab(false);
    onTab("files");
  };

  const openArtifacts = () => {
    setArtifactsTab(true);
    setFilesTab(false);
    onTab("artifacts");
  };

  const closeFiles = () => {
    setFilesTab(false);
    if (artifactsTab) {
      onTab("artifacts");
      return;
    }
    if (term.activeId || term.sessions[0]) {
      if (!term.activeId && term.sessions[0]) term.setActiveId(term.sessions[0].id);
      onTab("terminal");
      return;
    }
    onTab("home");
  };

  const closeArtifacts = () => {
    setArtifactsTab(false);
    if (filesTab) {
      onTab("files");
      return;
    }
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
          artifactsOn={page === "artifacts"}
          artifactsTab={artifactsTab}
          onSelectSession={(id) => {
            term.setActiveId(id);
            onTab("terminal");
          }}
          onCloseSession={closeSession}
          onFiles={openFiles}
          onCloseFiles={closeFiles}
          onArtifacts={openArtifacts}
          onCloseArtifacts={closeArtifacts}
          onNew={() => {
            void term.open();
            onTab("terminal");
          }}
        />
        <ChromeTools onMax={() => setMaxed((cur) => !cur)} onStow={onClose} />
      </header>
      {page === "home" ? (
        <div className="wb-home">
          <IslandCard
            hoverable
            color="app-teal"
            className="wb-tile"
            role="button"
            tabIndex={0}
            onClick={openTerminal}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openTerminal();
              }
            }}
          >
            <IconTerminal size={22} />
            <span>Terminal</span>
          </IslandCard>
          <IslandCard
            hoverable
            color="app-yellow"
            className="wb-tile"
            role="button"
            tabIndex={0}
            onClick={openFiles}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openFiles();
              }
            }}
          >
            <IconFile size={22} />
            <span>File</span>
          </IslandCard>
          <IslandCard
            hoverable
            color="brown"
            className="wb-tile"
            role="button"
            tabIndex={0}
            onClick={openArtifacts}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openArtifacts();
              }
            }}
          >
            <IconArtifacts size={22} />
            <span>产物</span>
          </IslandCard>
        </div>
      ) : page === "artifacts" ? (
        <ArtifactsPane token={token} runId={runId} projectId={projectId} refreshKey={refreshKey} onSaved={onSaved} />
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
      ) : (
        <TerminalView
          term={term}
          local={local}
          token={token}
          runId={runId}
          refreshKey={refreshKey}
          railOpen={railOpen}
          onToggleRail={() => setRailOpen((cur) => !cur)}
          onCloseSession={closeSession}
        />
      )}
    </aside>
  );
}

function useTerminalSessions(input: { folder: string; token: string; runId: string | null; local: boolean }) {
  const [sessions, setSessions] = useState<Array<{ id: string; label: string }>>([]);
  const [activeId, setActiveId] = useState("");
  const [output, setOutput] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, string[]>>({});
  const [historyAt, setHistoryAt] = useState<Record<string, number>>({});
  const [ptyById, setPtyById] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const cloudUnsubs = useRef(new Map<string, () => void>());
  const screens = useRef(new Map<string, ReturnType<typeof createTermScreen>>());
  const writes = useRef(Promise.resolve());
  const inputRef = useRef(input);
  const writeTarget = useRef("");
  inputRef.current = input;
  const writeQueue = useRef(
    createTermWriteQueue((data) => {
      const current = inputRef.current;
      const id = writeTarget.current;
      if (current.local) {
        void deskBridge()?.termWrite?.(id, data);
        return;
      }
      const runId = current.runId;
      if (!runId || !id) {
        return;
      }
      writes.current = writes.current
        .then(() => writeWorkspaceTerm(current.token, runId, id, data))
        .catch((caught) => {
          setError(caught instanceof Error ? caught.message : "写入失败");
        });
    }),
  );
  const label = defaultTermLabel();

  const adopt = useCallback((id: string, sessionLabel: string, pty?: boolean) => {
    setSessions((prev) => (prev.some((item) => item.id === id) ? prev : [...prev, { id, label: sessionLabel }]));
    setActiveId((cur) => cur || id);
    setOutput((prev) => (id in prev ? prev : { ...prev, [id]: "" }));
    if (pty !== undefined) {
      setPtyById((prev) => ({ ...prev, [id]: pty }));
    }
  }, []);

  const attachCloud = useCallback(
    (id: string) => {
      if (!input.runId || cloudUnsubs.current.has(id)) {
        return;
      }
      cloudUnsubs.current.set(id, () => undefined);
      const stop = subscribeWorkspaceTerm(input.token, input.runId, id, (event) => {
        if (event.type === "data") {
          const screen = applyTermChunk(screens.current.get(id) ?? createTermScreen(), event.chunk);
          screens.current.set(id, screen);
          setOutput((prev) => ({ ...prev, [id]: termScreenText(screen).slice(-60_000) }));
          return;
        }
        if (event.type === "exit") {
          const screen = applyTermChunk(screens.current.get(id) ?? createTermScreen(), "\n[已结束]\n");
          screens.current.set(id, screen);
          setOutput((prev) => ({ ...prev, [id]: termScreenText(screen) }));
        }
      });
      cloudUnsubs.current.set(id, stop);
    },
    [input.runId, input.token],
  );

  const open = useCallback(async () => {
    if (input.local) {
      const termOpen = deskBridge()?.termOpen;
      if (!input.folder) return;
      if (!termOpen) {
        setError(STALE_DESK_HINT);
        return;
      }
      const created = await termOpen(input.folder);
      if (created.error || !created.id) {
        setError(created.error || "打不开终端");
        return;
      }
      adopt(created.id, sessions.length === 0 ? label : `${label} ${sessions.length + 1}`);
      return;
    }
    if (!input.runId) {
      setError("发送任务后可以打开沙箱终端。");
      return;
    }
    try {
      const created = await openWorkspaceTerm(input.token, input.runId);
      adopt(created.id, created.shell || label, created.pty);
      attachCloud(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "打不开终端");
    }
  }, [adopt, attachCloud, input.folder, input.local, input.runId, input.token, label, sessions.length]);

  const ensure = useCallback(async () => {
    if (input.local) {
      if (sessions.length > 0) {
        return;
      }
      await open();
      return;
    }
    if (!input.runId) {
      setError("发送任务后可以打开沙箱终端。");
      return;
    }
    try {
      const existing = await ensureWorkspaceTerms(input.token, input.runId);
      for (const item of existing) {
        adopt(item.id, item.shell || label, item.pty);
        attachCloud(item.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "打不开终端");
    }
  }, [adopt, attachCloud, input.local, input.runId, input.token, label, open, sessions.length]);

  useEffect(() => {
    const bridge = deskBridge();
    if (!input.local || !bridge?.onTermData) return;
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
  }, [input.local]);

  useEffect(() => {
    const current = cloudUnsubs.current;
    return () => {
      for (const stop of current.values()) {
        stop();
      }
      current.clear();
    };
  }, [input.runId, input.token]);

  const write = (id: string, data: string) => {
    writeTarget.current = id;
    if (input.local) {
      void deskBridge()?.termWrite?.(id, data);
      return;
    }
    const immediate = data === "\r" || data === "\t" || data === "\x03" || data.includes("\r");
    writeQueue.current.push(data, immediate);
  };

  const close = (id: string) => {
    if (input.local) {
      void deskBridge()?.termClose?.(id);
    } else if (input.runId) {
      void closeWorkspaceTerm(input.token, input.runId, id).catch(() => undefined);
    }
    cloudUnsubs.current.get(id)?.();
    cloudUnsubs.current.delete(id);
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

  return {
    sessions,
    activeId,
    setActiveId,
    output,
    setOutput,
    drafts,
    setDrafts,
    history,
    setHistory,
    historyAt,
    setHistoryAt,
    ptyById,
    error,
    open,
    ensure,
    write,
    close,
  };
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
  artifactsOn,
  artifactsTab,
  onSelectSession,
  onCloseSession,
  onFiles,
  onCloseFiles,
  onArtifacts,
  onCloseArtifacts,
  onNew,
}: {
  sessions: Array<{ id: string; label: string }>;
  activeId: string;
  filesOn: boolean;
  filesTab: boolean;
  artifactsOn: boolean;
  artifactsTab: boolean;
  onSelectSession: (id: string) => void;
  onCloseSession: (id: string) => void;
  onFiles: () => void;
  onCloseFiles: () => void;
  onArtifacts: () => void;
  onCloseArtifacts: () => void;
  onNew: () => void;
}) {
  return (
    <div className="wb-tabs">
      {artifactsTab ? (
        <div className={`wb-tab${artifactsOn ? " on" : ""}`}>
          <button type="button" className="wb-tab-main" onClick={onArtifacts}>
            <IconArtifacts size={13} />
            <span className="wb-tab-label">产物</span>
          </button>
          <button
            type="button"
            className="wb-tab-close is-shown"
            aria-label="关闭产物"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCloseArtifacts();
            }}
          >
            <IconClose size={10} />
          </button>
        </div>
      ) : null}
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
        <div key={item.id} className={`wb-tab${item.id === activeId && !filesOn && !artifactsOn ? " on" : ""}`}>
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
  local,
  token,
  runId,
  refreshKey,
  railOpen,
  onToggleRail,
  onCloseSession,
}: {
  term: ReturnType<typeof useTerminalSessions>;
  local: boolean;
  token: string;
  runId: string | null;
  refreshKey: number;
  railOpen: boolean;
  onToggleRail: () => void;
  onCloseSession: (id: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const outRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  const draft = term.drafts[term.activeId] ?? "";
  const pty = !local && term.ptyById[term.activeId] !== false;

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
            <p className="wb-empty">{local ? "本机终端需要先选一个文件夹。" : "发送任务后可以打开沙箱终端。"}</p>
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
                  {(term.output[term.activeId] ?? "") + (pty ? "" : draft)}
                  <span className="term-caret" aria-hidden="true" />
                </pre>
                <textarea
                  ref={ghostRef}
                  className="term-ghost"
                  value={pty ? undefined : draft}
                  defaultValue={pty ? "" : undefined}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-label="终端输入"
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
                      term.write(term.activeId, value);
                    }
                  }}
                  onChange={(event) => {
                    const id = term.activeId;
                    if (pty) {
                      if (composing.current || Boolean((event.nativeEvent as InputEvent).isComposing)) {
                        return;
                      }
                      const value = event.target.value;
                      event.target.value = "";
                      if (value) {
                        term.write(id, value);
                      }
                      return;
                    }
                    term.setDrafts((prev) => ({ ...prev, [id]: event.target.value }));
                    term.setHistoryAt((prev) => ({ ...prev, [id]: -1 }));
                  }}
                  onKeyDown={(event) => {
                    const id = term.activeId;
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
                      term.write(id, bytes);
                      return;
                    }
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
                      term.write(id, `${draft}\n`);
                      if (draft.trim()) {
                        term.setHistory((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), draft] }));
                      }
                      term.setDrafts((prev) => ({ ...prev, [id]: "" }));
                      term.setHistoryAt((prev) => ({ ...prev, [id]: -1 }));
                      return;
                    }
                    if (action === "interrupt") {
                      term.write(id, "\x03");
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
          {!local ? <SetupLogs token={token} runId={runId} refreshKey={refreshKey} /> : null}
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
                    <IslandInput
                      value={newName}
                      autoFocus
                      aria-label="文件名"
                      onChange={(event) => setNewName(event.target.value)}
                    />
                    <IslandButton type="primary" htmlType="submit">
                      创建
                    </IslandButton>
                    <IslandButton type="default" onClick={() => setCreating(false)}>
                      取消
                    </IslandButton>
                  </form>
                ) : (
                  <IslandButton type="primary" onClick={startCreate}>
                    New File
                  </IslandButton>
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

function SetupLogs({
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
    <details className="term-setup">
      <summary>Setup 日志</summary>
      {error ? <p className="error">{error}</p> : null}
      {logs.length === 0 && !error ? <p className="hint">还没有 setup 日志。</p> : null}
      {logs.map((log) => (
        <article key={log.name}>
          <p className="eyebrow">{log.name}</p>
          <pre className="wb-preview">{log.content || "（空）"}</pre>
        </article>
      ))}
    </details>
  );
}

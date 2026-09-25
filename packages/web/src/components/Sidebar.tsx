import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import type { PatchRunRequest, Run } from "@neo-cloud-agent/contracts/run";
import { RUN_MODE_SHORT_LABELS, runDisplayTitle, runMode } from "@neo-cloud-agent/contracts/run";
import { formatListWhen, runListPlaceSuffix, runListTitle, STATUS_LABELS } from "../format";
import { BuddyMascot } from "@neo-cloud-agent/ui";
import { IconArchive, IconAutomations, IconChat, IconChevronRight, IconExperts, IconFolderClosed, IconFolderOpen, IconFolderPlus, IconLogout, IconMemory, IconMore, IconPlus, IconProjects, IconSearch, IconSidebarClose, IconSidebarOpen, IconSkills, IconSort, IconStar, IconTrash } from "../icons";
import { BuddyIcon, BuddyTargetToggle } from "@neo-cloud-agent/ui";
import { filterRuns, folderKindLabel, groupSidebarRuns, isShelvedRun, splitShelvedRuns } from "../pins";
import { isActiveRunStatus } from "@neo-cloud-agent/contracts/turn-state";
import { initials } from "../catalog";
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from "../pane-size";
import { ResizeHandle } from "./ResizeHandle";

export type VmSlotView = {
  id: string;
  status: string;
  runId: string | null;
};

type Props = {
  runs: Run[];
  currentRunId: string | null;
  slots?: VmSlotView[];
  backend?: string;
  userEmail: string;
  displayName?: string;
  avatarUrl?: string | null;
  authed: boolean;
  authBusy: boolean;
  health: string;
  streamDown?: boolean;
  sidebarWidth?: number;
  onSidebarWidth?: (next: number) => void;
  inbox?: ReactNode;
  accountMenu?: ReactNode;
  menuRef?: Ref<HTMLDetailsElement>;
  pinnedIds?: string[];
  projectNames?: Record<string, string>;
  onNewChat: () => void;
  onStartProjectChat?: (projectId: string) => void;
  onStartRepoChat?: (repoUrl?: string) => void;
  onOpenRun: (id: string) => void;
  onPatchTitle?: (id: string, body: PatchRunRequest) => Promise<void>;
  onPin?: (id: string) => void;
  onArchiveMany?: (ids: string[]) => void;
  onDeleteRun?: (id: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  sidebarOpen?: boolean;
  onToggle?: () => void;
  onClose?: () => void;
  buddy?: boolean;
  target?: "cloud" | "desk";
  deskDisabled?: boolean;
  onTarget?: (value: "cloud" | "desk") => void;
  nav?: "chat" | "projects" | "experts" | "skills" | "memories" | "automations" | "settings" | "context";
  onOpenNav?: (id: "automations" | "experts" | "projects" | "skills" | "memories") => void;
  searchOpen?: boolean;
  onOpenSearch?: () => void;
};

export function Sidebar({
  runs,
  currentRunId,
  userEmail,
  displayName = "",
  avatarUrl = null,
  authed,
  authBusy,
  health,
  streamDown = false,
  sidebarWidth = SIDEBAR_DEFAULT,
  onSidebarWidth,
  inbox,
  accountMenu,
  menuRef,
  pinnedIds = [],
  projectNames = {},
  onNewChat,
  onStartProjectChat,
  onStartRepoChat,
  onOpenRun,
  onPatchTitle,
  onPin,
  onArchiveMany,
  onDeleteRun,
  onLogin,
  onLogout,
  sidebarOpen = true,
  onToggle,
  onClose,
  buddy = false,
  target = "cloud",
  deskDisabled = false,
  onTarget,
  nav = "chat",
  onOpenNav,
  searchOpen = false,
  onOpenSearch,
}: Props) {
  const accountBox = useRef<{ el: HTMLDetailsElement | null }>({ el: null });
  const [accountOpen, setAccountOpen] = useState(false);
  useEffect(() => {
    if (!accountOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!accountBox.current.el?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [accountOpen]);
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [repoSort, setRepoSort] = useState<"recent" | "name">("recent");
  const skipTitleBlur = useRef(false);
  const items = [...runs].sort((left, right) => {
    const leftAt = left.updatedAt || left.createdAt;
    const rightAt = right.updatedAt || right.createdAt;
    return rightAt.localeCompare(leftAt) || right.createdAt.localeCompare(left.createdAt);
  });
  const visible = filterRuns(items, buddy ? query : "");
  const { live, shelved } = splitShelvedRuns(visible);
  const grouped = groupSidebarRuns(live, pinnedIds, projectNames);
  const repoFolders = [...grouped.repos].sort((left, right) => {
    if (repoSort === "name") return left.label.localeCompare(right.label, "zh-CN");
    const leftAt = [...left.active, ...left.recent][0]?.createdAt ?? "";
    const rightAt = [...right.active, ...right.recent][0]?.createdAt ?? "";
    return rightAt.localeCompare(leftAt);
  });
  const projectFolders = grouped.folders.filter((folder) => folder.active.length + folder.recent.length > 0);
  const projectRuns = projectFolders.flatMap((folder) => [...folder.active, ...folder.recent]);

  const folderOpen = (key: string, items: Run[]) =>
    items.some((item) => item.id === currentRunId) || !collapsedFolders.has(key);

  const onFolderToggle = (key: string, event: { currentTarget: EventTarget & HTMLDetailsElement }) => {
    const nextOpen = event.currentTarget.open;
    setCollapsedFolders((prev) => {
      const copy = new Set(prev);
      if (nextOpen) copy.delete(key);
      else copy.add(key);
      return copy;
    });
  };

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const startEdit = (run: Run) => {
    if (!onPatchTitle) return;
    const seed = ((run.title ?? "").trim() || runDisplayTitle(run)).split(/\r?\n/, 1)[0] ?? "";
    setEditingId(run.id);
    setDraft(seed.replace(/\s+/g, " ").trim());
    setTitleError("");
  };

  const cancelEdit = () => {
    if (titleBusy) return;
    skipTitleBlur.current = true;
    setEditingId(null);
    setDraft("");
    setTitleError("");
  };

  const saveTitle = async (run: Run, body: PatchRunRequest) => {
    if (!onPatchTitle) return;
    setTitleBusy(true);
    setTitleError("");
    try {
      await onPatchTitle(run.id, body);
      setEditingId(null);
      setDraft("");
    } catch (error) {
      setTitleError(error instanceof Error ? error.message : "重命名失败");
    } finally {
      setTitleBusy(false);
    }
  };

  const commitDraft = (run: Run) => {
    const next = draft.trim();
    const current = (run.title ?? "").trim();
    if (next === current) {
      cancelEdit();
      return;
    }
    void saveTitle(run, { title: next || null });
  };

  const renderRun = (run: Run) => {
    const running = isActiveRunStatus(run.status);
    const pinned = pinnedIds.includes(run.id);
    const canSelect = selecting && !isShelvedRun(run.status);
    const editing = editingId === run.id;
    const when = formatListWhen(run.updatedAt || run.createdAt);
    const statusHint = running ? `${STATUS_LABELS[run.status] ?? run.status}${runListPlaceSuffix(run)}` : when;
    const place = runMode(run.executionTarget) !== "cloud" ? RUN_MODE_SHORT_LABELS[runMode(run.executionTarget)] : "";
    const tip = [runListTitle(run), place, statusHint, onPatchTitle ? "双击重命名" : ""].filter(Boolean).join(" · ");
    return (
      <div
        key={run.id}
        className={`run-item${canSelect ? " is-selecting" : ""}${run.id === currentRunId ? " active" : ""}${running ? " busy" : ""}`}
        data-id={run.id}
        data-busy={running ? "true" : "false"}
        role="button"
        tabIndex={0}
        title={tip}
        aria-current={run.id === currentRunId ? "true" : undefined}
        onClick={() => {
          if (editing) return;
          if (canSelect) toggle(run.id);
          else onOpenRun(run.id);
        }}
        onKeyDown={(event) => {
          if (editing) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (canSelect) toggle(run.id);
            else onOpenRun(run.id);
          }
        }}
      >
        {canSelect ? (
          <input
            type="checkbox"
            className="run-check"
            checked={selected.includes(run.id)}
            onChange={() => toggle(run.id)}
            onClick={(event) => event.stopPropagation()}
            aria-label="选择对话"
          />
        ) : null}
        <span className="run-mark" aria-hidden="true">
          {running ? <span className="pulse-dot" /> : <IconChat size={14} />}
        </span>
        <div className="run-main">
          {editing ? (
            <div
              className="run-title-edit"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <input
                className="run-title-input"
                value={draft}
                maxLength={80}
                disabled={titleBusy}
                autoFocus
                aria-label="对话标题"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitDraft(run);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEdit();
                  }
                }}
                onBlur={() => {
                  if (skipTitleBlur.current) {
                    skipTitleBlur.current = false;
                    return;
                  }
                  if (!titleBusy) commitDraft(run);
                }}
              />
              <button
                type="button"
                className="title-generate"
                disabled={titleBusy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void saveTitle(run, { generate: true })}
              >
                {titleBusy ? "生成中" : "生成"}
              </button>
              {titleError ? <small className="run-title-error">{titleError}</small> : null}
            </div>
          ) : (
            <span
              className="run-title"
              onDoubleClick={(event) => {
                if (canSelect) return;
                event.preventDefault();
                event.stopPropagation();
                startEdit(run);
              }}
            >
              {runListTitle(run)}
            </span>
          )}
        </div>
        <div className="run-meta">
          <span className="run-actions">
            {onPin && !isShelvedRun(run.status) ? (
              <button
                type="button"
                className={pinned ? "pin is-on" : "pin"}
                aria-label={pinned ? "取消置顶" : "置顶"}
                onClick={(event) => {
                  event.stopPropagation();
                  onPin(run.id);
                }}
              >
                <IconStar size={14} />
              </button>
            ) : null}
            {onArchiveMany && !isShelvedRun(run.status) ? (
              <button
                type="button"
                className="pin"
                aria-label="归档"
                onClick={(event) => {
                  event.stopPropagation();
                  onArchiveMany([run.id]);
                }}
              >
                <IconArchive size={14} />
              </button>
            ) : null}
            {onDeleteRun && isShelvedRun(run.status) ? (
              <button
                type="button"
                className="pin run-delete"
                aria-label="删除归档任务"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteRun(run.id);
                }}
              >
                <IconTrash size={14} />
              </button>
            ) : null}
          </span>
        </div>
      </div>
    );
  };

  const listAndAccount = (
    <>
      <div className="run-library">
      {buddy ? (
        <div className="run-tools">
          <input
            type="search"
            className="run-search"
            placeholder="搜索任务"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索任务"
          />
        </div>
      ) : null}
      <div className="run-list" id="run-list">
        {grouped.pinned.length > 0 ? (
          <section className="run-group" data-section="pinned">
            <div className="run-section-head">
              <span>置顶</span>
            </div>
            {grouped.pinned.map(renderRun)}
          </section>
        ) : null}
        {projectFolders.length > 0 ? (
          <details
            className="run-group"
            data-section="projects"
            open={folderOpen("section:projects", projectRuns)}
            onToggle={(event) => onFolderToggle("section:projects", event)}
          >
            <summary className="run-section-head">
              <IconChevronRight size={12} className="run-folder-chevron" />
              <span>项目</span>
            </summary>
            {projectFolders.map((folder) => {
              const items = [...folder.active, ...folder.recent];
              const key = `project:${folder.key}`;
              const work = folderKindLabel(items);
              const open = folderOpen(key, items);
              return (
                <details
                  key={folder.key}
                  className="run-folder"
                  id={`run-folder-${folder.key}`}
                  data-kind="project"
                  data-work={work === "代码" ? "code" : work === "办公" ? "office" : undefined}
                  data-project={folder.key}
                  open={open}
                  onToggle={(event) => onFolderToggle(key, event)}
                >
                  <summary className="run-folder-head">
                    <IconChevronRight size={12} className="run-folder-chevron" />
                    {open ? <IconFolderOpen size={14} className="run-folder-icon" /> : <IconFolderClosed size={14} className="run-folder-icon" />}
                    <span className="run-folder-name">{folder.label}</span>
                    {onStartProjectChat ? (
                      <button
                        type="button"
                        className="run-folder-new"
                        aria-label={`在「${folder.label}」里开对话`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onStartProjectChat(folder.key);
                        }}
                      >
                        <IconPlus size={12} />
                      </button>
                    ) : null}
                  </summary>
                  {folder.active.map(renderRun)}
                  {folder.recent.map(renderRun)}
                </details>
              );
            })}
          </details>
        ) : null}
        <section className="run-group" data-section="repos">
          <div className="run-section-head">
            <span>仓库</span>
            <button
              type="button"
              className="run-folder-new"
              aria-label={repoSort === "recent" ? "按名称排序仓库" : "按最近排序仓库"}
              onClick={() => setRepoSort((value) => (value === "recent" ? "name" : "recent"))}
            >
              <IconSort size={12} />
            </button>
            {onStartRepoChat ? (
              <button type="button" className="run-folder-new" aria-label="新开绑仓对话" onClick={() => onStartRepoChat()}>
                <IconFolderPlus size={12} />
              </button>
            ) : null}
          </div>
          {repoFolders.map((folder) => {
            const items = [...folder.active, ...folder.recent];
            if (items.length === 0) return null;
            const key = `repo:${folder.key}`;
            const slug = folder.key.replace(/[^a-zA-Z0-9._-]+/g, "-");
            const open = folderOpen(key, items);
            return (
              <details
                key={folder.key}
                className="run-folder"
                id={`run-folder-repo-${slug}`}
                data-kind="repo"
                data-repo={folder.key}
                open={open}
                onToggle={(event) => onFolderToggle(key, event)}
              >
                <summary className="run-folder-head">
                  <IconChevronRight size={12} className="run-folder-chevron" />
                  {open ? <IconFolderOpen size={14} className="run-folder-icon" /> : <IconFolderClosed size={14} className="run-folder-icon" />}
                  <span className="run-folder-name">{folder.label}</span>
                  {onStartRepoChat && folder.source ? (
                    <button
                      type="button"
                      className="run-folder-new"
                      aria-label={`在「${folder.label}」开对话`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onStartRepoChat(folder.source);
                      }}
                    >
                      <IconPlus size={12} />
                    </button>
                  ) : null}
                </summary>
                {folder.active.map(renderRun)}
                {folder.recent.map(renderRun)}
              </details>
            );
          })}
        </section>
        <section className="run-group" data-section="chat">
          <div className="run-section-head">
            <span>日常</span>
          </div>
          {grouped.chat.active.map(renderRun)}
          {grouped.chat.recent.map(renderRun)}
        </section>
        {shelved.length > 0 ? (
          <details className="run-group run-archived">
            <summary className="eyebrow">已归档 · {shelved.length}</summary>
            {shelved.map(renderRun)}
          </details>
        ) : null}
      </div>
      </div>
      <footer className="sidebar-foot">
        <div className="account" id="account">
          {authed ? (
            <>
              <details
                className="account-pop"
                ref={(node) => {
                  accountBox.current.el = node;
                  if (typeof menuRef === "function") menuRef(node);
                  else if (menuRef) (menuRef as { current: HTMLDetailsElement | null }).current = node;
                }}
                open={accountOpen}
              >
                <summary
                  className="account-hit"
                  onClick={(event) => {
                    event.preventDefault();
                    setAccountOpen((value) => !value);
                  }}
                >
                  {avatarUrl ? (
                    <img className="account-avatar" src={avatarUrl} alt="" />
                  ) : (
                    <span className="account-avatar" aria-hidden="true">
                      {initials(displayName || userEmail)}
                    </span>
                  )}
                  <span className="account-id">
                    <span id="account-email">{displayName || userEmail}</span>
                    {displayName && userEmail && displayName !== userEmail ? <small>{userEmail}</small> : null}
                  </span>
                </summary>
                {accountOpen ? (
                  <div
                    className="account-sheet"
                    onClick={(event) => {
                      const action = (event.target as HTMLElement | null)?.closest("button, a");
                      if (action) setAccountOpen(false);
                    }}
                  >
                    {accountMenu}
                    <button type="button" id="logout" onClick={onLogout}>
                      <IconLogout size={16} />
                      退出
                    </button>
                  </div>
                ) : null}
              </details>
              {inbox}
            </>
          ) : (
            <button type="button" id="login" onClick={onLogin}>
              {authBusy ? "登录中…" : "登录"}
            </button>
          )}
        </div>
        <span id="health" hidden>
          {health}
        </span>
      </footer>
    </>
  );

  const moreMenu = (
    <div className="rail-more-pop" role="menu" aria-label="更多">
      <button type="button" role="menuitem" className={nav === "experts" ? "on" : undefined} onClick={() => onOpenNav?.("experts")}>
        <IconExperts size={16} />
        <span>专家</span>
      </button>
      <button type="button" role="menuitem" className={nav === "skills" ? "on" : undefined} onClick={() => onOpenNav?.("skills")}>
        <IconSkills size={16} />
        <span>技能</span>
      </button>
      <button type="button" role="menuitem" className={nav === "memories" ? "on" : undefined} onClick={() => onOpenNav?.("memories")}>
        <IconMemory size={16} />
        <span>记忆</span>
      </button>
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-body">
      <div className="sidebar-head">
        <div className="brand">
          <span className="mark">
            <BuddyMascot size={30} compact />
          </span>
          <div>
            <strong>Neo</strong>
            <span>Cloud Agent</span>
          </div>
        </div>
        {onToggle ? (
          <button
            className="icon-btn sidebar-toggle"
            id="sidebar-toggle"
            type="button"
            aria-label={sidebarOpen ? "收起侧栏" : "打开对话列表"}
            onClick={onToggle}
          >
            {sidebarOpen ? <IconSidebarClose size={16} /> : <IconSidebarOpen size={16} />}
          </button>
        ) : null}
      </div>
      {buddy ? (
        <>
          {onTarget ? <BuddyTargetToggle value={target} deskDisabled={deskDisabled} wide onChange={onTarget} /> : null}
          <nav className="buddy-nav" aria-label="目录">
            {(
              [
                ["automations", "自动化", IconAutomations],
                ["experts", "专家", IconExperts],
                ["projects", "项目", IconProjects],
                ["skills", "技能", IconSkills],
              ] as const
            ).map(([id, label, Icon]) => (
              <button key={id} type="button" onClick={() => onOpenNav?.(id)}>
                <Icon size={18} />
                <span>{label}</span>
                <BuddyIcon name="chevron" size={16} />
              </button>
            ))}
          </nav>
          <div className="buddy-task-head">
            <span>任务</span>
            {onArchiveMany ? (
              <button
                type="button"
                onClick={() => {
                  setSelecting((value) => !value);
                  setSelected([]);
                }}
              >
                {selecting ? "取消" : "编辑"}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      <div className="rail-stack">
      <button className="new-chat" id="new-chat" type="button" onClick={onNewChat}>
        <span className="new-chat-plus" aria-hidden="true">
          <IconPlus size={14} />
        </span>
        <span className="new-chat-label">{buddy ? "新建任务" : "新对话"}</span>
      </button>
      {buddy ? null : (
        <nav className="rail-nav" aria-label="功能">
          {onOpenSearch ? (
            <button
              type="button"
              className={searchOpen ? "rail-item on" : "rail-item"}
              aria-expanded={searchOpen}
              aria-haspopup="dialog"
              onClick={onOpenSearch}
            >
              <span className="rail-ico" aria-hidden="true">
                <IconSearch size={16} />
              </span>
              <span className="rail-label">搜索</span>
            </button>
          ) : null}
          <button type="button" className={nav === "automations" ? "rail-item on" : "rail-item"} onClick={() => onOpenNav?.("automations")}>
            <span className="rail-ico" aria-hidden="true">
              <IconAutomations size={16} />
            </span>
            <span className="rail-label">定时任务</span>
          </button>
          <button type="button" className={nav === "projects" ? "rail-item on" : "rail-item"} onClick={() => onOpenNav?.("projects")}>
            <span className="rail-ico" aria-hidden="true">
              <IconProjects size={16} />
            </span>
            <span className="rail-label">项目</span>
          </button>
          <div className="rail-more">
            <button type="button" className={nav === "experts" || nav === "skills" || nav === "memories" ? "rail-item on" : "rail-item"} aria-haspopup="menu">
              <span className="rail-ico" aria-hidden="true">
                <IconMore size={16} />
              </span>
              <span className="rail-label">更多</span>
            </button>
            {moreMenu}
          </div>
        </nav>
      )}
      </div>
      {listAndAccount}
      </div>
      {onSidebarWidth ? (
        <ResizeHandle label="调整左栏宽度" value={sidebarWidth} min={SIDEBAR_MIN} max={SIDEBAR_MAX} onChange={onSidebarWidth} />
      ) : null}
    </aside>
  );
}

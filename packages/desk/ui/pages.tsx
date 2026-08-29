import { describeAutomationSchedule, type Automation, type AutomationSchedule } from "@neo-cloud-agent/contracts/automation";
import { encodeExpertPick, expertPickerLabel, type Expert, type ExpertTeam } from "@neo-cloud-agent/contracts/expert";
import { Select } from "@neo-cloud-agent/ui";
import { Avatar } from "./Avatar";
import { IslandButton, IslandInput, IslandSwitch } from "./island";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { useDismissOnOutside } from "./dismiss";
import { composerTextareaHeight } from "../src/composer-size";
import { isLocalDeskKind, localRunLabel, TARGET_CLOUD, TARGET_DESK, TARGET_REMOTE, type DeskTargetKind } from "./desk";
import { IconAddRepo, IconArrowUp, IconChevronDown, IconCloud, IconComputer, IconPlus, IconProjects, IconSearch, IconStop, IconUnbindFolder } from "./icons";

export type ContextMenuId = "repo" | "target" | null;

export type ScheduleKind = "hourly" | "six_hours" | "daily_09" | "weekly_mon_09";
export type SearchFilter = "all" | "agents" | "files" | "actions" | "todos" | "settings";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
const MODELS_KEY = "neo-desk-models";

export const SCHEDULE_PRESETS: Array<{ id: ScheduleKind; label: string; schedule: AutomationSchedule }> = [
  { id: "hourly", label: "每小时", schedule: { kind: "every", minutes: 60 } },
  { id: "six_hours", label: "每 6 小时", schedule: { kind: "every", minutes: 360 } },
  { id: "daily_09", label: "每天上午 9 点", schedule: { kind: "daily", hour: 9 } },
  { id: "weekly_mon_09", label: "每周一上午 9 点", schedule: { kind: "weekly", weekday: 1, hour: 9 } },
];

export type SavedModel = { name: string; baseUrl: string };

export function loadSavedModels(): SavedModel[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MODELS_KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as { name?: unknown; baseUrl?: unknown };
        const name = typeof row.name === "string" ? row.name.trim() : "";
        const baseUrl = typeof row.baseUrl === "string" ? row.baseUrl.trim() : OPENAI_BASE_URL;
        return name ? { name, baseUrl } : null;
      })
      .filter((item): item is SavedModel => Boolean(item));
  } catch {
    return [];
  }
}

export function rememberSavedModel(model: SavedModel): SavedModel[] {
  const next = [model, ...loadSavedModels().filter((item) => item.name !== model.name)];
  localStorage.setItem(MODELS_KEY, JSON.stringify(next));
  return next;
}

function formatAddedAt(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "刚刚";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} 天前`;
  return `${Math.max(1, Math.round(day / 30))} 个月前`;
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <section className="page" data-page="true">
      {children}
    </section>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function SearchPalette({
  query,
  setQuery,
  filter,
  setFilter,
  hits,
  projectHits,
  todoHits,
  searchRef,
  onOpenRun,
  onOpenProject,
  onOpenTodo,
  onOpenSettings,
  onClose,
}: {
  query: string;
  setQuery: (value: string) => void;
  filter: SearchFilter;
  setFilter: (value: SearchFilter) => void;
  hits: Array<{ id: string; title: string; meta: string }>;
  projectHits?: Array<{ id: string; title: string; meta: string }>;
  todoHits?: Array<{ id: string; title: string; meta: string; projectId: string }>;
  searchRef: Ref<HTMLInputElement>;
  onOpenRun: (id: string) => void;
  onOpenProject?: (id: string) => void;
  onOpenTodo?: (projectId: string, todoId: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const tabs: Array<{ id: SearchFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "agents", label: "Agents" },
    { id: "files", label: "Files" },
    { id: "actions", label: "Actions" },
    { id: "todos", label: "待办" },
    { id: "settings", label: "Settings" },
  ];
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
    if (event.key === "Enter" && hits[0] && (filter === "all" || filter === "agents")) {
      event.preventDefault();
      onOpenRun(hits[0].id);
    }
  };
  return (
    <div className="palette-backdrop" role="presentation" onClick={onClose}>
      <div
        className="palette palette-float"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={searchRef}
          className="palette-input"
          value={query}
          placeholder="Search agents, files, actions…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKey}
        />
        <div className="palette-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={filter === tab.id ? "on" : ""}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="palette-body">
          {filter === "settings" ? (
            <button type="button" className="palette-row" onClick={onOpenSettings}>
              <strong>Models</strong>
              <span>配置模型名、API Key、Base URL</span>
            </button>
          ) : filter === "files" || filter === "actions" ? (
            <p className="palette-empty">还没有{filter === "files" ? "文件索引" : "快捷动作"}。</p>
          ) : filter === "todos" ? (
            todoHits && todoHits.length > 0 ? (
              todoHits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  className="palette-row"
                  onClick={() => onOpenTodo?.(hit.projectId, hit.id)}
                >
                  <strong>{hit.title}</strong>
                  <span>{hit.meta}</span>
                </button>
              ))
            ) : (
              <p className="palette-empty">{query.trim() ? "没有匹配的待办。" : "还没有待办。"}</p>
            )
          ) : hits.length === 0 && !projectHits?.length && !todoHits?.length ? (
            <p className="palette-empty">{query.trim() ? "没有匹配的对话、项目或待办。" : "还没有对话。"}</p>
          ) : (
            <>
              {projectHits && projectHits.length > 0 ? (
                <>
                  <p className="palette-label">项目</p>
                  {projectHits.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      className="palette-row"
                      onClick={() => onOpenProject?.(hit.id)}
                    >
                      <strong>{hit.title}</strong>
                      <span>{hit.meta}</span>
                    </button>
                  ))}
                </>
              ) : null}
              {todoHits && todoHits.length > 0 ? (
                <>
                  <p className="palette-label">待办</p>
                  {todoHits.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      className="palette-row"
                      onClick={() => onOpenTodo?.(hit.projectId, hit.id)}
                    >
                      <strong>{hit.title}</strong>
                      <span>{hit.meta}</span>
                    </button>
                  ))}
                </>
              ) : null}
              {hits.length > 0 ? <p className="palette-label">Recent Agents</p> : null}
              {hits.map((hit) => (
                <button key={hit.id} type="button" className="palette-row" onClick={() => onOpenRun(hit.id)}>
                  <strong>{hit.title}</strong>
                  <span>{hit.meta}</span>
                </button>
              ))}
            </>
          )}
        </div>
        <footer className="palette-foot">
          <span>Esc 关闭</span>
          <span>↑↓ 选择</span>
          <span>⏎ 打开</span>
        </footer>
      </div>
    </div>
  );
}

export type SettingsSection = "basics" | "avatars" | "models";

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; hint: string }> = [
  { id: "basics", label: "基础配置", hint: "这台电脑上的本机对话怎么跑。" },
  { id: "avatars", label: "头像", hint: "换设备登录同一账号也能看到。" },
  { id: "models", label: "模型配置", hint: "选对外型号。渠道和 Key 在 New API。" },
];

function AvatarSettingRow({
  title,
  src,
  label,
  fallback,
  previewClass,
  busy,
  onPick,
  onClear,
}: {
  title: string;
  src: string | null;
  label: string;
  fallback?: string;
  previewClass?: string;
  busy: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  return (
    <div className="avatar-setting">
      <Avatar src={src} label={label} fallback={fallback} className={`avatar-setting-preview${previewClass ? ` ${previewClass}` : ""}`} />
      <div className="avatar-setting-copy">
        <strong>{title}</strong>
        <div className="avatar-setting-actions">
          <label className="avatar-setting-pick">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onPick(file);
              }}
            />
            更换
          </label>
          <IslandButton type="default" htmlType="button" disabled={busy || !src} onClick={onClear}>
            恢复默认
          </IslandButton>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage({
  section,
  onSection,
  maxLocalRuns,
  onMaxLocalRuns,
  user,
  userAvatar,
  neoAvatar,
  avatarBusy,
  avatarError,
  onPickAvatar,
  onClearAvatar,
  name,
  setName,
  apiKey,
  setApiKey,
  baseUrl,
  setBaseUrl,
  configured,
  busy,
  error,
  onSave,
  newApi,
}: {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  maxLocalRuns: number;
  onMaxLocalRuns: (value: number) => void;
  user: string;
  userAvatar: string | null;
  neoAvatar: string | null;
  avatarBusy: boolean;
  avatarError?: string;
  onPickAvatar: (kind: "avatar" | "neoAvatar", file: File) => void;
  onClearAvatar: (kind: "avatar" | "neoAvatar") => void;
  name: string;
  setName: (value: string) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  baseUrl: string;
  setBaseUrl: (value: string) => void;
  configured: boolean;
  busy: boolean;
  error?: string;
  onSave: () => void;
  newApi?: { url: string | null; consoleUrl: string | null } | null;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };
  const consoleUrl = newApi?.consoleUrl || newApi?.url || "";
  const managed = Boolean(consoleUrl);
  const selectedModel = /vision/i.test(name)
    ? "deepseek-v4-flash-vision-exp"
    : /pro/i.test(name)
      ? "deepseek-v4-pro"
      : "deepseek-v4-flash";
  const current = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0];
  return (
    <Page>
      <header className="dash-head compact">
        <div>
          <h1>设置</h1>
          <p>{section === "models" && !managed ? "先只支持 OpenAI 协议。填模型名、API Key 和 Base URL。" : current.hint}</p>
        </div>
      </header>
      <div className="settings-shell">
        <nav className="settings-rail" aria-label="设置分栏">
          {SETTINGS_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === section ? "on" : undefined}
              onClick={() => onSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="settings-main">
          {section === "avatars" ? (
            <div className="settings-card">
              <h2>头像</h2>
              <AvatarSettingRow
                title="用户头像"
                src={userAvatar}
                label={user}
                busy={avatarBusy}
                onPick={(file) => onPickAvatar("avatar", file)}
                onClear={() => onClearAvatar("avatar")}
              />
              <AvatarSettingRow
                title="Neo 头像"
                src={neoAvatar}
                label="Neo"
                fallback="N"
                previewClass="neo-avatar"
                busy={avatarBusy}
                onPick={(file) => onPickAvatar("neoAvatar", file)}
                onClear={() => onClearAvatar("neoAvatar")}
              />
              <p className="hint">选图后立刻保存到账号。最长边会压到 256px。</p>
              {avatarError ? <p className="error">{avatarError}</p> : null}
            </div>
          ) : section === "basics" ? (
            <div className="settings-card">
              <h2>本机对话</h2>
              <label>
                <span>同时最多几条本机对话</span>
                <Select
                  value={String(maxLocalRuns)}
                  onValueChange={(value) => onMaxLocalRuns(Number(value))}
                  options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: `${n} 条` }))}
                />
              </label>
              <p className="hint">
                不同文件夹可以同时跑。每条都是一个独立进程，开太多会吃满内存和 CPU。
              </p>
            </div>
          ) : (
            <form className="settings-card" onSubmit={submit}>
              <h2>{managed ? "New API" : "OpenAI compatible"}</h2>
              {managed ? (
                <>
                  <label>
                    <span>型号</span>
                    <Select
                      value={selectedModel}
                      onValueChange={setName}
                      options={[
                        { value: "deepseek-v4-flash", label: "Flash（便宜）" },
                        { value: "deepseek-v4-flash-vision-exp", label: "Flash Vision（看图）" },
                        { value: "deepseek-v4-pro", label: "Pro" },
                      ]}
                    />
                  </label>
                  <p className="hint">对话走控制面 Gateway，再打 New API。不要在 Desk 里贴上游 Key。</p>
                  <a className="link-btn" href={consoleUrl} target="_blank" rel="noreferrer">
                    打开 New API 控制台
                  </a>
                </>
              ) : (
                <>
                  <label>
                    <span>模型名</span>
                    <IslandInput value={name} onChange={(event) => setName(event.target.value)} placeholder="gpt-4o-mini" autoComplete="off" />
                  </label>
                  <label>
                    <span>API Key</span>
                    <IslandInput
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={configured ? "已保存，留空则保持" : "sk-…"}
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    <span>Base URL</span>
                    <IslandInput
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder={OPENAI_BASE_URL}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span>协议</span>
                    <Select value="openai" disabled onValueChange={() => undefined} options={[{ value: "openai", label: "OpenAI" }]} />
                  </label>
                </>
              )}
              {error ? <p className="error">{error}</p> : null}
              <IslandButton
                type="primary"
                htmlType="submit"
                loading={busy}
                disabled={busy || !name.trim() || (!managed && !configured && !apiKey.trim())}
              >
                {busy ? "保存中…" : "保存"}
              </IslandButton>
            </form>
          )}
        </div>
      </div>
    </Page>
  );
}

export function AutomationsPage({
  items,
  onCreate,
  onToggle,
  onOpenRun,
}: {
  items: Automation[];
  onCreate: () => void;
  onToggle: (item: Automation) => void;
  onOpenRun: (id: string) => void;
}) {
  return (
    <Page>
      <header className="dash-head">
        <div>
          <h1>定时任务</h1>
          <p>到点自动开一轮对话，走同一控制面 /v1/automations。</p>
        </div>
        <IslandButton type="primary" onClick={onCreate}>
          <IconPlus size={16} />
          新建任务
        </IslandButton>
      </header>
      <div className="page-body">
        {items.length === 0 ? (
          <button type="button" className="empty-copy empty-cta" onClick={onCreate}>
            还没有定时任务。点这里或右上角新建。
          </button>
        ) : (
          <ul className="auto-list">
            {items.map((item) => (
              <li key={item.id} className="dash-card auto-card">
                <div>
                  <strong>{item.name || item.prompt}</strong>
                  <p>{describeAutomationSchedule(item.schedule)}</p>
                  <p className="pane-note">下次 {formatAddedAt(item.nextRunAt)}</p>
                </div>
                <div className="card-actions">
                  {item.lastRunId ? (
                    <IslandButton type="text" onClick={() => onOpenRun(item.lastRunId!)}>
                      打开上次对话
                    </IslandButton>
                  ) : null}
                  <IslandSwitch
                    checked={item.enabled}
                    aria-label={item.enabled ? "暂停任务" : "开启任务"}
                    onChange={() => onToggle(item)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}

export function ProjectsPage({
  items,
  query,
  setQuery,
  activeId,
  onCreate,
  onSelect,
}: {
  items: Project[];
  query: string;
  setQuery: (value: string) => void;
  activeId?: string | null;
  onCreate: () => void;
  onSelect: (item: Project | null) => void;
}) {
  const visible = items.filter((item) => !query.trim() || item.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Page>
      <header className="dash-head">
        <div className="dash-copy">
          <h1>项目</h1>
          <p>多人协同，打造超级团队</p>
        </div>
        <IslandButton type="primary" onClick={onCreate}>
          <IconPlus size={16} />
          新建项目
        </IslandButton>
      </header>
      <div className="page-body">
        <div className="mine-head">
          <h2>我的项目</h2>
          <label className="mine-search">
            <IconSearch size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" />
          </label>
        </div>
        {visible.length === 0 ? (
          items.length === 0 ? (
            <button type="button" className="empty-copy empty-cta" onClick={onCreate}>
              还没有项目。点这里或右上角新建。
            </button>
          ) : (
            <p className="empty-copy">没有匹配的项目。</p>
          )
        ) : (
          <div className="project-grid">
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`dash-card project-tile${activeId === item.id ? " active" : ""}`}
                onClick={() => onSelect(item)}
              >
                <span className="tile-icon">
                  <IconProjects />
                </span>
                <span className="tile-copy">
                  <strong>{item.name}</strong>
                  <em>添加于 {formatAddedAt(item.createdAt)}</em>
                </span>
                <span className="tile-more" aria-hidden="true">
                  ⋮
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}

/**
 * Workspace / where-it-runs, under the composer.
 *
 * Cloud keeps the default unbound repo and is not selectable for now.
 * This Computer can open a folder or stay unbound. Remote Control needs a folder.
 */
export function ContextBar({
  workspaces,
  folder,
  onWorkspace,
  onClearFolder,
  onPickFolder,
  branch,
  targetKind,
  canRunLocal,
  onTarget,
  open,
  setOpen,
  locked,
}: {
  workspaces: Array<{ id: string; folder: string; name: string; git: boolean }>;
  folder: string;
  onWorkspace: (workspace: { id: string; folder: string }) => void;
  onClearFolder: () => void;
  onPickFolder: (kind?: DeskTargetKind) => void;
  branch: string;
  targetKind: DeskTargetKind;
  canRunLocal: boolean;
  onTarget: (kind: DeskTargetKind) => void;
  open: ContextMenuId;
  setOpen: (id: ContextMenuId) => void;
  locked?: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open !== null && !locked, () => setOpen(null), barRef);
  const local = isLocalDeskKind(targetKind);
  const remoteNeedsFolder = !folder;
  const folderPickerOpen = !locked && local && open === "repo";
  const activeFolder = workspaces.find((item) => trimTrailingSlash(item.folder) === trimTrailingSlash(folder));
  const workspaceLabel = local
    ? activeFolder?.name || (folder ? lastSegment(folder) : targetKind === TARGET_REMOTE ? "选择文件夹" : "不绑定文件夹")
    : "不关联仓库";

  return (
    <div className="context-bar" ref={barRef}>
      <div className="context-item-wrap">
        <button
          type="button"
          className="context-item"
          disabled={locked || !local}
          onClick={() => setOpen(open === "repo" ? null : "repo")}
        >
          {local ? folder ? <IconComputer size={13} /> : <IconUnbindFolder size={13} /> : null}
          <span>{workspaceLabel}</span>
          {local ? <IconChevronDown size={12} /> : null}
        </button>
        {folderPickerOpen ? (
          <div className="context-menu" role="menu">
            <button
              type="button"
              onClick={() => {
                onPickFolder(targetKind);
                setOpen(null);
              }}
            >
              <IconAddRepo size={13} />
              打开文件夹…
            </button>
            {targetKind === TARGET_DESK ? (
              <button
                type="button"
                className={!folder ? "on" : ""}
                onClick={() => {
                  onClearFolder();
                  setOpen(null);
                }}
              >
                <IconUnbindFolder size={13} />
                不绑定文件夹
              </button>
            ) : null}
            {workspaces.length > 0 ? <p className="context-menu-label">已选择</p> : null}
            {workspaces.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item === activeFolder ? "on" : ""}
                onClick={() => {
                  onWorkspace(item);
                  setOpen(null);
                }}
              >
                <IconComputer size={13} />
                <span title={item.git ? undefined : "不是 git 仓库"}>{item.name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {local ? null : (
        <button type="button" className="context-item" disabled>
          <span>{branch}</span>
        </button>
      )}
      <div className="context-item-wrap">
        <button
          type="button"
          className="context-item"
          disabled={locked}
          onClick={() => setOpen(open === "target" ? null : "target")}
        >
          {local ? <IconComputer size={14} /> : <IconCloud size={14} />}
          <span>{targetKind === TARGET_REMOTE ? "Remote Control" : local ? "This Computer" : "Cloud"}</span>
          <IconChevronDown size={12} />
        </button>
        {open === "target" && !locked ? (
          <div className="context-menu" role="menu">
            <button
              type="button"
              className={targetKind === TARGET_CLOUD ? "on" : ""}
              onClick={() => {
                onTarget(TARGET_CLOUD);
                setOpen(null);
              }}
            >
              <IconCloud size={14} />
              Cloud
            </button>
            <button
              type="button"
              className={targetKind === TARGET_DESK ? "on" : ""}
              disabled={!canRunLocal}
              onClick={() => {
                onTarget(TARGET_DESK);
                setOpen(null);
              }}
            >
              <IconComputer size={14} />
              {!canRunLocal ? "This Computer（需要 Desk）" : "This Computer"}
            </button>
            <button
              type="button"
              className={targetKind === TARGET_REMOTE ? "on" : ""}
              disabled={!canRunLocal || remoteNeedsFolder}
              onClick={() => {
                onTarget(TARGET_REMOTE);
                setOpen(null);
              }}
            >
              <IconComputer size={14} />
              {!canRunLocal ? "Remote Control（需要 Desk）" : "Remote Control"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function trimTrailingSlash(value: string): string {
  return (value || "").replace(/[\\/]+$/, "");
}

function lastSegment(value: string): string {
  return trimTrailingSlash(value).split(/[\\/]/).pop() || value;
}

export type ComposerMention = {
  kind: "asset" | "todo" | "file" | "command" | "expert" | "team";
  id: string;
  label: string;
  insert: string;
};

function mentionTrigger(text: string): { trigger: "@" | "/"; query: string } | null {
  const at = text.lastIndexOf("@");
  const slash = text.lastIndexOf("/");
  const idx = Math.max(at, slash);
  if (idx < 0) return null;
  if (idx > 0 && !/\s/.test(text[idx - 1]!)) return null;
  const after = text.slice(idx + 1);
  if (after.includes("\n") || after.includes(" ")) return null;
  return { trigger: text[idx] as "@" | "/", query: after };
}

function mentionKindLabel(kind: ComposerMention["kind"]): string {
  if (kind === "asset") return "资产";
  if (kind === "todo") return "待办";
  if (kind === "file") return "文件";
  if (kind === "expert") return "专家";
  if (kind === "team") return "专家团";
  return "自动化";
}

export function ChatComposer({
  prompt,
  setPrompt,
  placeholder,
  sending,
  locked,
  models,
  selected,
  menuOpen,
  setMenuOpen,
  onSelectModel,
  onAddModel,
  onSubmit,
  taRef,
  onComposerKey,
  home,
  mentions,
  waiting,
  onStop,
  experts,
  teams,
  expertValue,
  expertLocked,
  onExpert,
  onMention,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  placeholder: string;
  sending: boolean;
  locked?: boolean;
  models: string[];
  selected: string;
  menuOpen: boolean;
  setMenuOpen: (value: boolean) => void;
  onSelectModel: (name: string) => void;
  onAddModel: () => void;
  onSubmit: () => void;
  taRef: Ref<HTMLTextAreaElement>;
  onComposerKey: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  home?: boolean;
  mentions?: ComposerMention[];
  waiting?: boolean;
  onStop?: () => void;
  experts?: Expert[];
  teams?: ExpertTeam[];
  expertValue?: string;
  expertLocked?: boolean;
  onExpert?: (value: string) => void;
  onMention?: (item: ComposerMention) => void;
}) {
  const label = selected || "Auto";
  const boxRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(menuOpen, () => setMenuOpen(false), modelRef);
  const typed = mentionTrigger(prompt);
  const mentionHits = (mentions ?? []).filter((item) => {
    if (typed === null) return false;
    if (typed.trigger === "/" ? item.kind !== "command" : item.kind === "command") return false;
    const q = typed.query.toLowerCase();
    return !q || item.label.toLowerCase().includes(q) || item.kind.includes(q);
  }).slice(0, 8);

  const pickMention = (item: ComposerMention) => {
    const idx = Math.max(prompt.lastIndexOf("@"), prompt.lastIndexOf("/"));
    const next = `${prompt.slice(0, Math.max(0, idx))}${item.insert} `;
    setPrompt(next);
    onMention?.(item);
    requestAnimationFrame(() => {
      const ta = taRef && typeof taRef !== "function" ? taRef.current : null;
      ta?.focus();
    });
  };

  useLayoutEffect(() => {
    const ta = taRef && typeof taRef !== "function" ? taRef.current : null;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${composerTextareaHeight(ta.scrollHeight, Boolean(home))}px`;
  }, [home, prompt, taRef]);

  const waitingNow = Boolean(waiting);
  const inner = (
    <>
      <textarea
        ref={taRef}
        value={prompt}
        placeholder={placeholder}
        disabled={locked}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && mentionHits.length > 0) {
            event.preventDefault();
            setPrompt(prompt.replace(/[@/][^\s@/]*$/, ""));
            return;
          }
          if (event.key === "Enter" && !event.shiftKey && mentionHits[0] && typed !== null) {
            event.preventDefault();
            pickMention(mentionHits[0]);
            return;
          }
          onComposerKey(event);
        }}
        rows={1}
      />
      {mentionHits.length > 0 ? (
        <div className="mention-menu" role="listbox" aria-label={typed?.trigger === "/" ? "调用已有自动化" : "引用文件或项目内容"}>
          {mentionHits.map((item) => (
            <button key={`${item.kind}-${item.id}`} type="button" onClick={() => pickMention(item)}>
              <em>{mentionKindLabel(item.kind)}</em>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="composer-tools">
        {onExpert ? (
          <label className="expert-pick">
            <span>专家</span>
            <Select
              size="pill"
              aria-label="专家"
              value={expertValue ?? ""}
              disabled={expertLocked}
              onValueChange={onExpert}
              groups={[
                { label: "默认", options: [{ value: "", label: "Neo" }] },
                ...((experts ?? []).length > 0
                  ? [{ label: "专家", options: (experts ?? []).map((item) => ({ value: encodeExpertPick({ expertId: item.id }), label: expertPickerLabel(item) })) }]
                  : []),
                ...((teams ?? []).length > 0
                  ? [{ label: "专家团", options: (teams ?? []).map((item) => ({ value: encodeExpertPick({ expertTeamId: item.id }), label: `团 · ${item.name}` })) }]
                  : []),
              ]}
            />
          </label>
        ) : null}
        {/* Model and send belong together on the right; spreading them apart
            left a wide gap where the eye expects one control group. */}
        <div className="composer-send-group">
          <div className="model-wrap" ref={modelRef}>
            <button type="button" className="model-trigger" onClick={() => setMenuOpen(!menuOpen)}>
              {label}
              <IconChevronDown size={12} />
            </button>
            {menuOpen ? (
              <div className="model-menu" role="menu">
                <p className="palette-label">Your models</p>
                {models.length === 0 ? <p className="pane-note">还没有配置模型</p> : null}
                {models.map((name) => (
                  <button key={name} type="button" className={name === selected ? "on" : ""} onClick={() => onSelectModel(name)}>
                    <span>{name}</span>
                    {name === selected ? <span className="check">✓</span> : null}
                  </button>
                ))}
                <button type="button" className="add-model" onClick={onAddModel}>
                  Add Models
                </button>
              </div>
            ) : null}
          </div>
          {onStop && waitingNow ? (
            <button type="button" className="send-btn stop" aria-label="停止" onClick={onStop}>
              <IconStop size={14} />
            </button>
          ) : (
            <button type="button" className="send-btn" aria-label="Send" disabled={locked || sending || !prompt.trim()} onClick={onSubmit}>
              <IconArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </>
  );

  if (home) {
    return (
      <div className="composer composer-stack home">
        {inner}
      </div>
    );
  }

  return (
    <div ref={boxRef} className="composer-follow">
      <div className="composer composer-stack follow">{inner}</div>
    </div>
  );
}

export function ProjectCreateForm({
  name,
  setName,
  instruction,
  setInstruction,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  name: string;
  setName: (value: string) => void;
  instruction: string;
  setInstruction: (value: string) => void;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="modal-form" onSubmit={submit}>
      <label>
        <span>项目名称</span>
        <IslandInput
          value={name}
          maxLength={15}
          onChange={(event) => setName(event.target.value.slice(0, 15))}
          placeholder="请输入项目名称"
          autoComplete="off"
          autoFocus
        />
        <em className="count">{name.length}/15</em>
      </label>
      <label>
        <span>指令</span>
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="提供当前项目的背景信息和规范，让回复更精准。比如：项目目标、团队习惯、风格偏好、输出约束等"
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <footer className="modal-actions">
        <IslandButton type="default" onClick={onCancel}>
          取消
        </IslandButton>
        <IslandButton type="primary" htmlType="submit" disabled={busy || !name.trim()}>
          {busy ? "创建中…" : "确定"}
        </IslandButton>
      </footer>
    </form>
  );
}

export function AutomationCreateForm({
  prompt,
  setPrompt,
  preset,
  setPreset,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  preset: ScheduleKind;
  setPreset: (value: ScheduleKind) => void;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="modal-form" onSubmit={submit}>
      <label>
        <span>要做的事</span>
        <IslandInput
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="每天检查一下仓库有没有测试失败"
          autoComplete="off"
          autoFocus
        />
      </label>
      <label>
        <span>频率</span>
        <Select
          value={preset}
          onValueChange={(value) => setPreset(value as ScheduleKind)}
          options={SCHEDULE_PRESETS.map((item) => ({ value: item.id, label: item.label }))}
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <footer className="modal-actions">
        <IslandButton type="default" onClick={onCancel}>
          取消
        </IslandButton>
        <IslandButton type="primary" htmlType="submit" disabled={busy || !prompt.trim()}>
          {busy ? "创建中…" : "确定"}
        </IslandButton>
      </footer>
    </form>
  );
}

export function runSearchMeta(run: Run, repo: string, cloud: boolean, rel: string): string {
  return `${repo} · ${cloud ? "Cloud" : localRunLabel(run)} · ${rel}`;
}

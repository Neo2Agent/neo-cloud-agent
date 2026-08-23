import { describeAutomationSchedule, type Automation, type AutomationSchedule } from "@neo-cloud-agent/contracts/automation";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { IconArrowUp, IconCloud, IconComputer, IconPlus, IconProjects, IconSearch } from "./icons";

const COMPOSER_MIN = 400;
const COMPOSER_MAX = 680;

export type ContextMenuId = "repo" | "target" | null;
export type RepoChoice = { url: string; label: string };

export type ScheduleKind = "hourly" | "six_hours" | "daily_09" | "weekly_mon_09";
export type SearchFilter = "all" | "agents" | "files" | "actions" | "settings";

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

export function formatAddedAt(iso: string): string {
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
  searchRef,
  onOpenRun,
  onOpenSettings,
  onClose,
}: {
  query: string;
  setQuery: (value: string) => void;
  filter: SearchFilter;
  setFilter: (value: SearchFilter) => void;
  hits: Array<{ id: string; title: string; meta: string }>;
  searchRef: Ref<HTMLInputElement>;
  onOpenRun: (id: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const tabs: Array<{ id: SearchFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "agents", label: "Agents" },
    { id: "files", label: "Files" },
    { id: "actions", label: "Actions" },
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
          ) : hits.length === 0 ? (
            <p className="palette-empty">{query.trim() ? "没有匹配的对话。" : "还没有对话。"}</p>
          ) : (
            <>
              <p className="palette-label">Recent Agents</p>
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

export function ModelSettingsPage({
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
  children,
}: {
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
  children?: ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };
  return (
    <Page>
      <header className="dash-head compact">
        <div>
          <h1>Models</h1>
          <p>先只支持 OpenAI 协议。填模型名、API Key 和 Base URL。</p>
        </div>
      </header>
      <div className="page-body">
        <form className="settings-card" onSubmit={submit}>
          <h2>OpenAI compatible</h2>
          <label>
            <span>模型名</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="gpt-4o-mini" autoComplete="off" />
          </label>
          <label>
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={configured ? "已保存，留空则保持" : "sk-…"}
              autoComplete="new-password"
            />
          </label>
          <label>
            <span>Base URL</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={OPENAI_BASE_URL}
              autoComplete="off"
            />
          </label>
          <label>
            <span>协议</span>
            <select value="openai" disabled>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" className="dash-create" disabled={busy || !name.trim() || (!configured && !apiKey.trim())}>
            {busy ? "保存中…" : "保存"}
          </button>
        </form>
        {children}
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
        <button type="button" className="dash-create" onClick={onCreate}>
          <IconPlus size={16} />
          新建任务
        </button>
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
                  <p className="pane-note">
                    {item.enabled ? "开启" : "暂停"} · 下次 {formatAddedAt(item.nextRunAt)}
                  </p>
                </div>
                <div className="card-actions">
                  {item.lastRunId ? (
                    <button type="button" onClick={() => onOpenRun(item.lastRunId!)}>
                      打开上次对话
                    </button>
                  ) : null}
                  <button type="button" onClick={() => onToggle(item)}>
                    {item.enabled ? "暂停" : "开启"}
                  </button>
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
        <button type="button" className="dash-create" onClick={onCreate}>
          <IconPlus size={16} />
          新建项目
        </button>
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

export function ContextBar({
  repoLabel,
  repos,
  repoUrl,
  onRepo,
  branch,
  targetKind,
  canRunLocal,
  onTarget,
  open,
  setOpen,
  locked,
}: {
  repoLabel: string;
  repos: RepoChoice[];
  repoUrl: string;
  onRepo: (url: string) => void;
  branch: string;
  targetKind: "cloud" | "desk" | "remote";
  canRunLocal: boolean;
  onTarget: (kind: "cloud" | "desk") => void;
  open: ContextMenuId;
  setOpen: (id: ContextMenuId) => void;
  locked?: boolean;
}) {
  const targetLabel = targetKind === "desk" ? "This Computer" : "Cloud";
  return (
    <div className="context-bar">
      <div className="context-item-wrap">
        <button
          type="button"
          className="context-item"
          disabled={locked}
          onClick={() => setOpen(open === "repo" ? null : "repo")}
        >
          <span>{repoLabel}</span>
          <em>▾</em>
        </button>
        {open === "repo" && !locked ? (
          <div className="context-menu" role="menu">
            {repos.map((item) => (
              <button
                key={item.url || "inbox"}
                type="button"
                className={item.url === repoUrl ? "on" : ""}
                onClick={() => {
                  onRepo(item.url);
                  setOpen(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button type="button" className="context-item" disabled>
        <span>{branch}</span>
        <em>▾</em>
      </button>
      <div className="context-item-wrap">
        <button
          type="button"
          className="context-item"
          disabled={locked}
          onClick={() => setOpen(open === "target" ? null : "target")}
        >
          {targetKind === "desk" ? <IconComputer size={14} /> : <IconCloud size={14} />}
          <span>{targetLabel}</span>
          <em>▾</em>
        </button>
        {open === "target" && !locked ? (
          <div className="context-menu" role="menu">
            <button
              type="button"
              className={targetKind === "cloud" ? "on" : ""}
              onClick={() => {
                onTarget("cloud");
                setOpen(null);
              }}
            >
              <IconCloud size={14} />
              Cloud
            </button>
            <button
              type="button"
              className={targetKind === "desk" ? "on" : ""}
              disabled={!canRunLocal}
              onClick={() => {
                if (!canRunLocal) return;
                onTarget("desk");
                setOpen(null);
              }}
            >
              <IconComputer size={14} />
              {canRunLocal ? "This Computer" : "This Computer（需要 Desk）"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ChatComposer({
  prompt,
  setPrompt,
  placeholder,
  sending,
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
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  placeholder: string;
  sending: boolean;
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
}) {
  const label = selected || "Add Models";
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(COMPOSER_MIN);

  useLayoutEffect(() => {
    const node = measureRef.current;
    if (!node) return;
    const grown = Math.ceil(node.getBoundingClientRect().width) + 72;
    setWidth(Math.min(COMPOSER_MAX, Math.max(COMPOSER_MIN, grown)));
  }, [prompt]);

  useLayoutEffect(() => {
    const ta = taRef && typeof taRef !== "function" ? taRef.current : null;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(128, Math.max(22, ta.scrollHeight))}px`;
  }, [prompt, taRef]);

  return (
    <div className={`composer composer-stack${home ? " home" : ""}`} style={{ width }}>
      <span className="composer-measure" ref={measureRef}>
        {prompt || " "}
      </span>
      <textarea
        ref={taRef}
        value={prompt}
        placeholder={placeholder}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={onComposerKey}
        rows={1}
      />
      <div className="composer-tools">
        <div className="model-wrap">
          <button type="button" className="model-trigger" onClick={() => setMenuOpen(!menuOpen)}>
            {label}
            <span aria-hidden="true">▾</span>
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
        <button type="button" className="send-btn" aria-label="Send" disabled={sending || !prompt.trim()} onClick={onSubmit}>
          <IconArrowUp size={16} />
        </button>
      </div>
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
        <input
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
        <button type="button" className="ghost" onClick={onCancel}>
          取消
        </button>
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? "创建中…" : "确定"}
        </button>
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
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="每天检查一下仓库有没有测试失败"
          autoComplete="off"
          autoFocus
        />
      </label>
      <label>
        <span>频率</span>
        <select value={preset} onChange={(event) => setPreset(event.target.value as ScheduleKind)}>
          {SCHEDULE_PRESETS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="error">{error}</p> : null}
      <footer className="modal-actions">
        <button type="button" className="ghost" onClick={onCancel}>
          取消
        </button>
        <button type="submit" disabled={busy || !prompt.trim()}>
          {busy ? "创建中…" : "确定"}
        </button>
      </footer>
    </form>
  );
}

export function runSearchMeta(run: Run, repo: string, cloud: boolean, rel: string): string {
  return `${repo} · ${cloud ? "Cloud" : "This Computer"} · ${rel}`;
}

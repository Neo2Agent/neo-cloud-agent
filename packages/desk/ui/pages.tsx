import { describeAutomationSchedule, type Automation, type AutomationSchedule } from "@neo-cloud-agent/contracts/automation";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { FormEvent, ReactNode, Ref } from "react";
import { IconPlus, IconProjects, IconSearch } from "./icons";

export type ScheduleKind = "hourly" | "six_hours" | "daily_09" | "weekly_mon_09";

export const SCHEDULE_PRESETS: Array<{ id: ScheduleKind; label: string; schedule: AutomationSchedule }> = [
  { id: "hourly", label: "每小时", schedule: { kind: "every", minutes: 60 } },
  { id: "six_hours", label: "每 6 小时", schedule: { kind: "every", minutes: 360 } },
  { id: "daily_09", label: "每天上午 9 点", schedule: { kind: "daily", hour: 9 } },
  { id: "weekly_mon_09", label: "每周一上午 9 点", schedule: { kind: "weekly", weekday: 1, hour: 9 } },
];

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

export function SearchPage({
  query,
  setQuery,
  empty,
  children,
  searchRef,
}: {
  query: string;
  setQuery: (value: string) => void;
  empty: ReactNode;
  children?: ReactNode;
  searchRef: Ref<HTMLInputElement>;
}) {
  return (
    <Page>
      <header className="dash-head compact">
        <div>
          <h1>搜索</h1>
          <p>从已有对话里找标题、仓库、分支、状态或项目。</p>
        </div>
      </header>
      <div className="page-body">
        <input
          ref={searchRef}
          className="search search-main"
          value={query}
          placeholder="搜索对话、仓库、分支、状态或项目"
          onChange={(event) => setQuery(event.target.value)}
        />
        {empty}
        {children}
      </div>
    </Page>
  );
}

export function SettingsPage({ children }: { children: ReactNode }) {
  return (
    <Page>
      <header className="dash-head compact">
        <div>
          <h1>设置</h1>
          <p>Desk 执行目标和问答模式。Provider key 仍在 gateway。</p>
        </div>
      </header>
      <div className="page-body">{children}</div>
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
          <button type="button" className="dash-create" onClick={onCreate}>
            <IconPlus size={16} />
            新建项目
          </button>
        </div>
        <TeamArt />
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

function TeamArt() {
  return (
    <svg className="team-art" viewBox="0 0 260 110" aria-hidden="true">
      <circle cx="32" cy="28" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 80c4-24 30-24 34 0" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="42" y="38" width="13" height="17" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="98" cy="26" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M82 80c4-24 30-24 34 0" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M84 58h28l-4 9H88z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="148" y="16" width="28" height="20" rx="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="157" cy="26" r="2" fill="currentColor" />
      <circle cx="167" cy="26" r="2" fill="currentColor" />
      <rect x="144" y="40" width="36" height="26" rx="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M154 54h16" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="226" cy="26" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M210 80c4-24 30-24 34 0" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="216" y="44" width="11" height="15" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="223" y="40" width="11" height="15" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M48 30C70 8 80 8 88 18" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" />
      <path d="M116 30C132 8 146 8 158 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" />
      <path d="M182 28C200 8 210 8 216 18" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" />
    </svg>
  );
}

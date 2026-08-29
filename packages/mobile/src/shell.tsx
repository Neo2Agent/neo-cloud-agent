import { BrandMark, BuddyIcon, BuddyTargetToggle } from "@neo-cloud-agent/ui";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { preview, STATUS_LABELS } from "./format";
import { isActiveRunStatus } from "./turn";

export function BuddyLogin(props: {
  busy: boolean;
  error: string;
  onSubmit: (email: string, password: string) => void;
}) {
  return (
    <div className="auth buddy-login-page">
      <form
        className="auth-card"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const email = (form.elements.namedItem("account") as HTMLInputElement).value;
          const password = (form.elements.namedItem("secret") as HTMLInputElement).value;
          props.onSubmit(email, password);
        }}
      >
        <div className="auth-brand buddy-login">
          <span className="mark">
            <BrandMark />
          </span>
          <h1 className="buddy-hello">Neo</h1>
          <p className="buddy-login-kicker">Cloud Agent</p>
        </div>
        <p>先登录，再下任务</p>
        <label>
          账号
          <input name="account" autoComplete="username" placeholder="请输入账号" />
        </label>
        <label>
          密码
          <input name="secret" type="password" autoComplete="current-password" placeholder="请输入密码" />
        </label>
        {props.error ? <p className="error">{props.error}</p> : null}
        <button className="primary" type="submit" disabled={props.busy}>
          {props.busy ? "登录中…" : "登录"}
        </button>
        <p className="buddy-login-hint">手机只打云端 /v1，不在本机跑 Agent。</p>
      </form>
    </div>
  );
}

export function BuddyDrawer(props: {
  open: boolean;
  runs: Run[];
  userEmail: string;
  health: string;
  target: "cloud" | "desk";
  deskDisabled: boolean;
  onTarget: (value: "cloud" | "desk") => void;
  onClose: () => void;
  onNew: () => void;
  onOpenRun: (id: string) => void;
  onOpenNav: (id: "automations" | "experts" | "projects" | "skills" | "settings") => void;
}) {
  if (!props.open) return null;
  return (
    <div className="buddy-drawer-root">
      <button type="button" className="buddy-sheet-backdrop" aria-label="关闭侧栏" onClick={props.onClose} />
      <aside className="buddy-drawer">
        <div className="sidebar-head">
          <div className="brand">
            <span className="mark">
              <BrandMark />
            </span>
            <strong>Neo</strong>
          </div>
        </div>
        <BuddyTargetToggle value={props.target} deskDisabled={props.deskDisabled} onChange={props.onTarget} />
        <nav className="buddy-nav" aria-label="目录">
          {(
            [
              ["automations", "自动化", "clock"],
              ["experts", "专家", "expert"],
              ["projects", "项目", "project"],
              ["skills", "技能", "skill"],
            ] as const
          ).map(([id, label, icon]) => (
            <button key={id} type="button" onClick={() => props.onOpenNav(id)}>
              <BuddyIcon name={icon} size={18} />
              <span>{label}</span>
              <BuddyIcon name="chevron" size={16} />
            </button>
          ))}
        </nav>
        <div className="buddy-task-head">
          <span>任务</span>
        </div>
        <button className="new-chat" type="button" onClick={props.onNew}>
          + 新建任务
        </button>
        <div className="run-list">
          {props.runs.length === 0 ? <p className="empty">暂无近期任务</p> : null}
          {props.runs.map((run) => (
            <button key={run.id} className="run-row" type="button" onClick={() => props.onOpenRun(run.id)}>
              <b>
                {isActiveRunStatus(run.status) ? "● " : ""}
                {preview(run.prompt)}
              </b>
              <span>
                {STATUS_LABELS[run.status] ?? run.status}
                {run.vmSlotId ? " · VM" : ""}
              </span>
            </button>
          ))}
        </div>
        <footer className="sidebar-foot">
          <span>{props.userEmail || "已登录"}</span>
          <small>{props.health}</small>
          <button type="button" className="ghost" onClick={() => props.onOpenNav("settings")}>
            设置
          </button>
        </footer>
      </aside>
    </div>
  );
}

export function CatalogList(props: {
  title: string;
  empty: string;
  items: Array<{ id: string; label: string; hint?: string }>;
  onBack: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <div className="app">
      <header className="topbar">
        <button className="ghost" type="button" onClick={props.onBack}>
          返回
        </button>
        <h1>{props.title}</h1>
      </header>
      <div className="list">
        {props.items.length === 0 ? <p className="empty">{props.empty}</p> : null}
        {props.items.map((item) => (
          <button key={item.id} className="run-row" type="button" onClick={() => props.onPick(item.id)}>
            <b>{item.label}</b>
            {item.hint ? <span>{item.hint}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

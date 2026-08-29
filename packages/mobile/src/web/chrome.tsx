import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { CHAT_MODELS, chatModelLabel, preview, resolveChatModel } from "../format";
import { dayGreeting } from "../island-theme";
import { mergeSpokenText } from "../voice";
import { runRowMeta } from "../session";
import { isActiveRunStatus } from "../turn";
import { IslandButton, IslandCard, IslandInput, IslandTitle } from "./island";
import { browserVoiceSupported, startBrowserVoice } from "./voice";

export function Page({ title, onBack, action, children }: { title: string; onBack: () => void; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" type="button" onClick={onBack} aria-label="返回">
          ←
        </button>
        <h1>{title}</h1>
        {action}
      </header>
      <div className="page-body">{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function IslandLogin(props: {
  busy: boolean;
  error: string;
  onSubmit: (email: string, password: string) => void;
}) {
  return (
    <div className="login-shell">
      <IslandCard className="login-card">
        <IslandTitle size="large">Neo</IslandTitle>
        <p>欢迎回来</p>
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = event.currentTarget;
            props.onSubmit(
              (form.elements.namedItem("account") as HTMLInputElement).value,
              (form.elements.namedItem("secret") as HTMLInputElement).value,
            );
          }}
        >
          <label>
            账号
            <IslandInput name="account" autoComplete="username" placeholder="admin" />
          </label>
          <label>
            密码
            <IslandInput name="secret" type="password" autoComplete="current-password" />
          </label>
          {props.error ? <p className="error">{props.error}</p> : null}
          <IslandButton type="primary" submit disabled={props.busy} style={{ width: "100%", marginTop: 8 }}>
            {props.busy ? "登录中…" : "Continue"}
          </IslandButton>
        </form>
        <p className="hint">手机只订云端 /v1。新开对话不会发到本机 Desk。</p>
      </IslandCard>
    </div>
  );
}

export function IslandDrawer(props: {
  open: boolean;
  runs: Run[];
  userEmail: string;
  health: string;
  onClose: () => void;
  onNew: () => void;
  onOpenRun: (id: string) => void;
  onOpenNav: (id: "home" | "automations" | "experts" | "projects" | "settings") => void;
}) {
  const [mounted, setMounted] = useState(props.open);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (props.open) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setEntered(true);
        });
      });
      return () => {
        cancelled = true;
      };
    }
    setEntered(false);
    const timer = window.setTimeout(() => {
      if (!cancelled) setMounted(false);
    }, 360);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [props.open]);

  if (!mounted) return null;
  return (
    <div className={entered ? "drawer-root is-open" : "drawer-root"} aria-hidden={!entered}>
      <button type="button" className="drawer-backdrop" aria-label="关闭侧栏" onClick={props.onClose} />
      <aside className="drawer">
        <div className="drawer-brand">Neo</div>
        <IslandButton type="primary" onClick={props.onNew}>
          新建对话
        </IslandButton>
        {(
          [
            ["automations", "定时任务"],
            ["projects", "项目"],
            ["experts", "专家"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className="nav" onClick={() => props.onOpenNav(id)}>
            {label}
          </button>
        ))}
        <div className="section">近期</div>
        {props.runs.length === 0 ? <p className="empty">暂无近期任务</p> : null}
        {props.runs.slice(0, 20).map((run) => (
          <button key={run.id} className="run-row" type="button" onClick={() => props.onOpenRun(run.id)}>
            <b>
              {isActiveRunStatus(run.status) ? "● " : ""}
              {preview(run.prompt)}
            </b>
            <span>{runRowMeta(run)}</span>
          </button>
        ))}
        <footer className="drawer-foot">
          <div className="drawer-account">
            <div>{props.userEmail || "已登录"}</div>
            <small>{props.health}</small>
          </div>
          <button type="button" className="drawer-settings" aria-label="设置" onClick={() => props.onOpenNav("settings")}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94a7.6 7.6 0 0 0 .05-.94 7.6 7.6 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.24-1.12.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.81 8.48a.5.5 0 0 0 .12.64L4.96 10.7a7.6 7.6 0 0 0-.05.94 7.6 7.6 0 0 0 .05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.51.39 1.05.7 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.24 1.12-.55 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
          </button>
        </footer>
      </aside>
    </div>
  );
}

export function IslandHome({ expertName }: { expertName?: string }) {
  return (
    <div className="home-hero">
      <h2>
        {dayGreeting()}，今天想做点什么
      </h2>
      <p>{expertName ? `已选专家 ${expertName}` : "新开一条云端对话，或从左边打开已有任务。"}</p>
    </div>
  );
}

export function IslandComposer(props: {
  prompt: string;
  locked: boolean;
  placeholder: string;
  sending: boolean;
  canStop: boolean;
  model: string;
  onModel: (value: string) => void;
  onPrompt: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState("");
  const voiceRef = useRef<{ stop: () => Promise<string> } | null>(null);
  const basePrompt = useRef(props.prompt);
  const promptRef = useRef(props.prompt);
  promptRef.current = props.prompt;
  const canVoice = browserVoiceSupported();
  const selected = resolveChatModel(props.model);

  useEffect(() => () => {
    void voiceRef.current?.stop();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".composer-model-wrap")) return;
      setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const stopVoice = async () => {
    const session = voiceRef.current;
    voiceRef.current = null;
    setListening(false);
    if (!session) return;
    const spoken = await session.stop();
    const next = mergeSpokenText(basePrompt.current, spoken);
    if (next !== promptRef.current) props.onPrompt(next);
  };

  const toggleVoice = async () => {
    if (props.locked || props.sending) return;
    if (listening) {
      await stopVoice();
      return;
    }
    if (!canVoice) {
      setVoiceHint("当前浏览器不支持语音输入");
      return;
    }
    setVoiceHint("");
    setMenuOpen(false);
    basePrompt.current = props.prompt;
    const session = startBrowserVoice((text) => props.onPrompt(mergeSpokenText(basePrompt.current, text)));
    if (!session) {
      setVoiceHint("无法开始语音输入");
      return;
    }
    voiceRef.current = session;
    setListening(true);
  };

  return (
    <div className="composer-dock">
      <div className="composer-bar">
        <textarea
          className="composer-field"
          value={props.prompt}
          disabled={props.locked}
          placeholder={listening ? "正在听…" : props.placeholder}
          rows={2}
          onChange={(event) => props.onPrompt(event.target.value)}
        />
        <div className="composer-tools">
          <div className="composer-model-wrap">
            <button
              type="button"
              className="composer-model"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-label="选择模型"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {chatModelLabel(props.model)}
              <span aria-hidden="true">▴</span>
            </button>
            {menuOpen ? (
              <div className="composer-model-menu" role="listbox" aria-label="模型">
                {CHAT_MODELS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={item.id === selected}
                    className={item.id === selected ? "on" : undefined}
                    onClick={() => {
                      props.onModel(item.id);
                      setMenuOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="composer-send-group">
            <button
              type="button"
              className={listening ? "composer-mic is-on" : "composer-mic"}
              aria-label={listening ? "停止语音输入" : "语音输入"}
              aria-pressed={listening}
              disabled={props.locked || props.sending}
              title={canVoice ? (listening ? "点一下结束" : "语音输入") : "当前浏览器不支持语音输入"}
              onClick={() => void toggleVoice()}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z"
                />
              </svg>
            </button>
            {props.canStop ? (
              <button type="button" className="composer-send is-stop" aria-label="停止" onClick={props.onStop}>
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                className="composer-send"
                aria-label="发送"
                disabled={props.locked || props.sending || !props.prompt.trim()}
                onClick={props.onSend}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 19V5M5 12l7-7 7 7"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
      {voiceHint ? <p className="composer-legal">{voiceHint}</p> : <p className="composer-legal">内容由 AI 生成</p>}
    </div>
  );
}

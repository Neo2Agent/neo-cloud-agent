import { BrandMark } from "@neo-cloud-agent/ui";
import { isDeskApp } from "../desk";
import { isNarrowViewport } from "../viewport";

type AuthMode = "login" | "token";

type Props = {
  open: boolean;
  mode: AuthMode;
  busy: boolean;
  error: string;
  email: string;
  password: string;
  token: string;
  onMode: (mode: AuthMode) => void;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onToken: (value: string) => void;
  onSubmit: () => void;
};

export function AuthGate({
  open,
  mode,
  busy,
  error,
  email,
  password,
  token,
  onMode,
  onEmail,
  onPassword,
  onToken,
  onSubmit,
}: Props) {
  const phone = isNarrowViewport();
  const effectiveMode = phone ? "login" : mode;
  const title = effectiveMode === "token" ? "服务令牌" : isDeskApp() ? "登录 Desk" : "登录 Neo";
  const copy =
    effectiveMode === "token"
      ? "控制面开启了服务令牌。多个设备用同一条 CONTROL_PLANE_TOKEN 即可订阅流。"
      : isDeskApp()
        ? "Desk 与 Web 共用账号。登录后可以选本机执行。"
        : "输入账号和密码，进入云端 Agent。";
  const canSubmit = effectiveMode === "token" ? Boolean(token.trim()) : Boolean(email.trim() && password);
  const submit = busy ? "登录中…" : effectiveMode === "token" ? "使用令牌" : "登录";

  return (
    <div className="auth-gate" id="auth-gate" hidden={!open}>
      <form
        className="auth-card"
        id="auth-form"
        autoComplete="off"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit || busy) return;
          onSubmit();
        }}
      >
        <div className="auth-brand">
          <span className="mark">
            <BrandMark />
          </span>
          <p className="login-kicker">Neo Cloud Agent</p>
        </div>
        <h2 id="auth-title">{title}</h2>
        <p id="auth-copy">{copy}</p>
        {phone ? null : (
          <div className="auth-tabs" id="auth-tabs">
            {(["login", "token"] as const).map((item) => (
              <button key={item} type="button" data-mode={item} className={mode === item ? "active" : ""} onClick={() => onMode(item)}>
                {item === "login" ? "登录" : "服务令牌"}
              </button>
            ))}
          </div>
        )}
        <div id="auth-user-fields" hidden={effectiveMode === "token"}>
          <label className="auth-field" htmlFor="auth-email">
            <span>账号</span>
            <input
              id="auth-email"
              name="account"
              type="text"
              inputMode="text"
              enterKeyHint="next"
              autoComplete="username"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              lang="zh-CN"
              placeholder="请输入账号"
              value={email}
              onChange={(event) => onEmail(event.target.value)}
            />
          </label>
          <label className="auth-field" htmlFor="auth-password">
            <span>密码</span>
            <input
              id="auth-password"
              name="secret"
              type="password"
              enterKeyHint="done"
              autoComplete="current-password"
              placeholder="请输入密码"
              value={password}
              onChange={(event) => onPassword(event.target.value)}
            />
          </label>
        </div>
        <label className="auth-field" htmlFor="auth-token" hidden={effectiveMode !== "token"}>
          <span>服务令牌</span>
          <input
            id="auth-token"
            name="token"
            type="password"
            autoComplete="off"
            placeholder="neo_…"
            value={token}
            onChange={(event) => onToken(event.target.value)}
          />
        </label>
        <p className="auth-error" id="auth-error" hidden={!error}>
          {error}
        </p>
        <button type="submit" id="auth-submit" className="auth-submit" disabled={busy || !canSubmit}>
          {submit}
        </button>
      </form>
    </div>
  );
}

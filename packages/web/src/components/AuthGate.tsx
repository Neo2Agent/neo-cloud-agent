import { BuddyMascot } from "@neo-cloud-agent/ui";
import { isDeskApp } from "../desk";
import { isNarrowViewport } from "../viewport";

export type AuthMode = "login" | "register" | "token";

type Props = {
  open: boolean;
  mode: AuthMode;
  busy: boolean;
  error: string;
  email: string;
  username: string;
  phone: string;
  password: string;
  token: string;
  onMode: (mode: AuthMode) => void;
  onEmail: (value: string) => void;
  onUsername: (value: string) => void;
  onPhone: (value: string) => void;
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
  username,
  phone,
  password,
  token,
  onMode,
  onEmail,
  onUsername,
  onPhone,
  onPassword,
  onToken,
  onSubmit,
}: Props) {
  const narrow = isNarrowViewport();
  const effectiveMode = narrow && mode === "token" ? "login" : mode;
  const registering = effectiveMode === "register";
  const title =
    effectiveMode === "token" ? "服务令牌" : registering ? "注册 Neo" : isDeskApp() ? "登录 Desk" : "登录 Neo";
  const copy =
    effectiveMode === "token"
      ? "控制面开启了服务令牌。多个设备用同一条 CONTROL_PLANE_TOKEN 即可订阅流。"
      : registering
        ? "用手机号注册。用户名或手机号都能登录，不需要验证码。"
        : isDeskApp()
          ? "Desk 与 Web 共用账号。登录后可以选本机执行。"
          : "用户名或手机号加密码，进入云端 Agent。";
  const canSubmit =
    effectiveMode === "token"
      ? Boolean(token.trim())
      : registering
        ? Boolean(username.trim() && phone.trim() && password)
        : Boolean(email.trim() && password);
  const submit = busy
    ? registering
      ? "注册中…"
      : "登录中…"
    : effectiveMode === "token"
      ? "使用令牌"
      : registering
        ? "注册并登录"
        : "登录";

  return (
    <div className={narrow ? "auth-gate is-buddy" : "auth-gate"} id="auth-gate" hidden={!open}>
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
        <div className={narrow ? "auth-brand buddy-login" : "auth-brand"}>
          {narrow ? (
            <BuddyMascot size={108} face />
          ) : (
            <span className="mark">
              <BuddyMascot size={30} compact />
            </span>
          )}
          {narrow ? (
            <>
              <h2 id="auth-title" className="buddy-hello">
                Neo
              </h2>
              <p className="buddy-login-kicker">Cloud Agent</p>
            </>
          ) : (
            <p className="login-kicker">Neo Cloud Agent</p>
          )}
        </div>
        {narrow ? null : <h2 id="auth-title">{title}</h2>}
        <p id="auth-copy">{narrow ? (registering ? "手机号注册，马上开始" : "先登录，再下任务") : copy}</p>
        {narrow ? (
          <div className="auth-tabs" id="auth-tabs">
            {(["login", "register"] as const).map((item) => (
              <button
                key={item}
                type="button"
                data-mode={item}
                className={effectiveMode === item ? "active" : ""}
                onClick={() => onMode(item)}
              >
                {item === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>
        ) : (
          <div className="auth-tabs" id="auth-tabs">
            {(["login", "register", "token"] as const).map((item) => (
              <button key={item} type="button" data-mode={item} className={mode === item ? "active" : ""} onClick={() => onMode(item)}>
                {item === "login" ? "登录" : item === "register" ? "注册" : "服务令牌"}
              </button>
            ))}
          </div>
        )}
        <div id="auth-user-fields" hidden={effectiveMode === "token"}>
          {registering ? (
            <>
              <label className="auth-field" htmlFor="auth-username">
                <span>用户名</span>
                <input
                  id="auth-username"
                  name="username"
                  type="text"
                  inputMode="text"
                  enterKeyHint="next"
                  autoComplete="username"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  lang="zh-CN"
                  placeholder="字母开头，2–32 位"
                  value={username}
                  onChange={(event) => onUsername(event.target.value)}
                />
              </label>
              <label className="auth-field" htmlFor="auth-phone">
                <span>手机号</span>
                <input
                  id="auth-phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  enterKeyHint="next"
                  autoComplete="tel"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="11 位手机号，无需验证码"
                  value={phone}
                  onChange={(event) => onPhone(event.target.value)}
                />
              </label>
            </>
          ) : (
            <label className="auth-field" htmlFor="auth-email">
              <span>用户名或手机号</span>
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
                placeholder="用户名或手机号"
                value={email}
                onChange={(event) => onEmail(event.target.value)}
              />
            </label>
          )}
          <label className="auth-field" htmlFor="auth-password">
            <span>密码</span>
            <input
              id="auth-password"
              name="secret"
              type="password"
              enterKeyHint="done"
              autoComplete={registering ? "new-password" : "current-password"}
              placeholder={registering ? "至少 6 位" : "请输入密码"}
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
        <p className="auth-switch">
          {registering ? (
            <>
              已有账号？
              <button type="button" onClick={() => onMode("login")}>
                去登录
              </button>
            </>
          ) : effectiveMode === "login" ? (
            <>
              没有账号？
              <button type="button" onClick={() => onMode("register")}>
                手机号注册
              </button>
            </>
          ) : null}
        </p>
        {narrow ? <p className="buddy-login-hint">手机只打云端 /v1，不在本机跑 Agent。</p> : null}
      </form>
    </div>
  );
}

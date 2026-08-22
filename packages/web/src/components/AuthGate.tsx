import type { FocusEvent } from "react";
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

function unlockField(event: FocusEvent<HTMLInputElement>) {
  event.currentTarget.removeAttribute("readOnly");
}

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
  const title = effectiveMode === "token" ? "服务令牌" : "登录";
  const copy =
    effectiveMode === "token"
      ? "控制面开启了服务令牌。多个设备用同一条 CONTROL_PLANE_TOKEN 即可订阅流。"
      : "请输入账号和密码后登录。";
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
          <input
            id="auth-email"
            name="neo-account"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            readOnly
            placeholder="账号"
            value={email}
            onFocus={unlockField}
            onChange={(event) => onEmail(event.target.value)}
          />
          <input
            id="auth-password"
            name="neo-secret"
            type="password"
            autoComplete="new-password"
            readOnly
            placeholder="密码"
            value={password}
            onFocus={unlockField}
            onChange={(event) => onPassword(event.target.value)}
          />
        </div>
        <input
          id="auth-token"
          name="neo-token"
          type="password"
          autoComplete="off"
          placeholder="neo_…"
          hidden={effectiveMode !== "token"}
          value={token}
          onChange={(event) => onToken(event.target.value)}
        />
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

type AuthMode = "login" | "token";

type Props = {
  open: boolean;
  mode: AuthMode;
  busy: boolean;
  error: string;
  canSkip: boolean;
  email: string;
  password: string;
  token: string;
  onClose: () => void;
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
  canSkip,
  email,
  password,
  token,
  onClose,
  onMode,
  onEmail,
  onPassword,
  onToken,
  onSubmit,
}: Props) {
  const title = mode === "token" ? "服务令牌" : "登录";
  const copy =
    mode === "token"
      ? "控制面开启了服务令牌。多个设备用同一条 CONTROL_PLANE_TOKEN 即可订阅流。"
      : "账号 admin，密码 123456。登录会查询账号库。";
  const submit = busy ? "登录中…" : mode === "token" ? "使用令牌" : "登录";

  return (
    <div
      className="auth-gate"
      id="auth-gate"
      hidden={!open}
      onClick={(event) => {
        if (event.target === event.currentTarget && canSkip) onClose();
      }}
    >
      <form
        className="auth-card"
        id="auth-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <h2 id="auth-title">{title}</h2>
        <p id="auth-copy">{copy}</p>
        <div className="auth-tabs" id="auth-tabs">
          {(["login", "token"] as const).map((item) => (
            <button key={item} type="button" data-mode={item} className={mode === item ? "active" : ""} onClick={() => onMode(item)}>
              {item === "login" ? "登录" : "服务令牌"}
            </button>
          ))}
        </div>
        <div id="auth-user-fields" hidden={mode === "token"}>
          <input
            id="auth-email"
            name="login"
            type="text"
            inputMode="text"
            autoComplete="username"
            placeholder="账号"
            value={email}
            onChange={(event) => onEmail(event.target.value)}
          />
          <input
            id="auth-password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="密码"
            value={password}
            onChange={(event) => onPassword(event.target.value)}
          />
        </div>
        <input
          id="auth-token"
          name="token"
          type="password"
          autoComplete="current-password"
          placeholder="neo_…"
          hidden={mode !== "token"}
          value={token}
          onChange={(event) => onToken(event.target.value)}
        />
        <p className="auth-error" id="auth-error" hidden={!error}>
          {error}
        </p>
        <button type="submit" id="auth-submit" className="auth-submit" disabled={busy}>
          {submit}
        </button>
        <button type="button" id="auth-skip" hidden={!canSkip} onClick={onClose}>
          先不登录
        </button>
      </form>
    </div>
  );
}

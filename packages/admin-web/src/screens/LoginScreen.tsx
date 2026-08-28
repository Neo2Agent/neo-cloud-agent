import { BrandMark } from "@neo-cloud-agent/ui";

type Props = {
  email: string;
  password: string;
  busy: boolean;
  error: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: () => void;
};

export function LoginScreen({ email, password, busy, error, onEmail, onPassword, onSubmit }: Props) {
  const canSubmit = Boolean(email.trim() && password) && !busy;
  return (
    <div className="auth-gate">
      <form
        className="auth-card"
        autoComplete="off"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit();
        }}
      >
        <div className="auth-brand">
          <span className="mark">
            <BrandMark />
          </span>
          <p className="login-kicker">Neo Cloud Agent</p>
        </div>
        <h2>登录管理台</h2>
        <p>只有平台管理员能进入。账号和密码需要手输，页面不会预填。</p>
        <div className="auth-fields">
          <label className="auth-field">
            <span>账号</span>
            <input
              name="account"
              type="text"
              inputMode="text"
              enterKeyHint="next"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="请输入账号"
              value={email}
              onChange={(event) => onEmail(event.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>密码</span>
            <input
              name="password"
              type="password"
              enterKeyHint="go"
              autoComplete="current-password"
              placeholder="请输入密码"
              value={password}
              onChange={(event) => onPassword(event.target.value)}
            />
          </label>
        </div>
        {error ? <p className="auth-error">{error}</p> : null}
        <button type="submit" className="auth-submit" disabled={!canSubmit}>
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}

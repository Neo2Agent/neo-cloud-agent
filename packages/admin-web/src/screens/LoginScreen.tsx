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
    <div className="gate">
      <form
        className="auth"
        autoComplete="off"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit();
        }}
      >
        <div className="brand">
          <span className="mark">N</span>
          <div>
            <strong>Neo 管理台</strong>
            <span>独立应用，不和对话页共用</span>
          </div>
        </div>
        <h1>管理员登录</h1>
        <p className="muted">只有平台管理员能进入。账号和密码需要手输，页面不会预填。</p>
        <label className="field">
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
            value={email}
            onChange={(event) => onEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span>密码</span>
          <input
            name="password"
            type="password"
            enterKeyHint="go"
            autoComplete="current-password"
            value={password}
            onChange={(event) => onPassword(event.target.value)}
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={!canSubmit}>
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}

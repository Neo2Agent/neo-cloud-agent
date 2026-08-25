import { useCallback, useEffect, useState } from "react";
import { api, readJson, readToken, writeToken } from "./api";

type AdminOverview = {
  users: { total: number; admins: number };
  runs: { total: number; live: number };
  tokens: { usedMonth: number };
  quota: { maxTokensMonth: number; usedTokensMonth: number };
  capacity: { backend: string; total: number; busy: number; slots: Array<{ id: string; status: string; runId: string | null; mounted: boolean }> };
  rateLimit: { enabled: boolean; store: string };
  llm: { configured: boolean; upstream: string; model: string | null; baseUrl: string | null };
  newApi: { url: string | null; consoleUrl: string | null };
  platform: { metadataStore: string; eventBus: string; workerRuntime: string };
  counts: { automations: number; projects: number; builds: number; environments: number; desks: number };
};

type AdminUser = {
  id: string;
  email: string;
  orgId: string;
  admin: boolean;
  runCount: number;
  usedTokensMonth: number;
  concurrentRuns: number;
  lastActiveAt: string | null;
};

type AdminRun = {
  id: string;
  status: string;
  prompt: string;
  userId: string;
  model: string;
  updatedAt: string;
  usage?: { totalTokens?: number } | null;
};

type RateLimitSnapshot = {
  enabled: boolean;
  store: string;
  policies: Record<string, { remaining: number; limit: number; windowMs: number; kind: string }>;
};

const STATUS: Record<string, string> = {
  NOT_YET_STARTED: "排队中",
  PROVISIONING: "准备中",
  INSTALLING: "安装中",
  RUNNING: "运行中",
  IDLE: "空闲",
  WAITING_FOR_BACKGROUND_WORK: "后台任务",
  ERROR: "出错",
  ARCHIVED: "已归档",
  EXPIRED: "已过期",
};

function card(label: string, value: string, hint?: string) {
  return (
    <div className="card" key={label}>
      <p className="muted">{label}</p>
      <p className="value">{value}</p>
      {hint ? <p className="muted">{hint}</p> : null}
    </div>
  );
}

export function App() {
  const [token, setToken] = useState(readToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [runs, setRuns] = useState<AdminRun[]>([]);
  const [limits, setLimits] = useState<RateLimitSnapshot | null>(null);
  const [error, setError] = useState("");

  const persist = (next: string) => {
    writeToken(next);
    setToken(next);
  };

  const refresh = useCallback(async (session: string) => {
    const [overviewRes, usersRes, runsRes, limitsRes, meRes] = await Promise.all([
      api(session, "/v1/admin/overview"),
      api(session, "/v1/admin/users"),
      api(session, "/v1/admin/runs?limit=50"),
      api(session, "/v1/rate-limits"),
      api(session, "/v1/me"),
    ]);
    if (meRes.status === 401 || overviewRes.status === 401) {
      persist("");
      throw new Error("请重新登录");
    }
    if (overviewRes.status === 403) {
      persist("");
      throw new Error("需要平台管理员");
    }
    if (!overviewRes.ok) throw new Error("读取总览失败");
    const me = await readJson<{ user?: { email?: string } }>(meRes);
    setUserEmail(me.user?.email ?? "服务令牌");
    setOverview(await readJson<AdminOverview>(overviewRes));
    setUsers((await readJson<{ users?: AdminUser[] }>(usersRes)).users ?? []);
    setRuns((await readJson<{ runs?: AdminRun[] }>(runsRes)).runs ?? []);
    if (limitsRes.ok) setLimits(await readJson<RateLimitSnapshot>(limitsRes));
  }, []);

  useEffect(() => {
    if (!token) return;
    void refresh(token).catch((err) => {
      setAuthError(err instanceof Error ? err.message : "读取失败");
      persist("");
    });
  }, [refresh, token]);

  if (!token) {
    return (
      <div className="gate">
        <form
          className="auth"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !email.trim() || !password) return;
            setBusy(true);
            setAuthError("");
            void (async () => {
              const response = await api("", "/v1/auth/login", {
                method: "POST",
                body: JSON.stringify({ email: email.trim(), password }),
              });
              const body = await readJson<{ token?: string; error?: string; user?: { email?: string } }>(response);
              if (!response.ok) throw new Error(body.error === "admin_required" ? "需要平台管理员" : body.error || "登录失败");
              persist(body.token ?? "");
              setUserEmail(body.user?.email ?? "");
              setPassword("");
            })()
              .catch((err) => setAuthError(err instanceof Error ? err.message : "登录失败"))
              .finally(() => setBusy(false));
          }}
        >
          <p className="eyebrow">独立管理台</p>
          <h1>Neo Admin</h1>
          <p className="muted">这是单独的管理应用，不和对话页共用。只有平台管理员能登录。</p>
          <label>
            账号
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
          </label>
          <label>
            密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </label>
          {authError ? <p className="error">{authError}</p> : null}
          <button type="submit" disabled={busy}>
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <p className="eyebrow">独立管理台</p>
          <h1>平台用量和限流</h1>
        </div>
        <div className="top-actions">
          <span className="pill">{userEmail}</span>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void api(token, "/v1/auth/logout", { method: "POST" });
              persist("");
              setOverview(null);
            }}
          >
            退出
          </button>
          <button type="button" className="ghost" onClick={() => void refresh(token).catch((err) => setError(err instanceof Error ? err.message : "刷新失败"))}>
            刷新
          </button>
        </div>
      </header>
      {error ? <p className="error">{error}</p> : null}
      {overview ? (
        <div className="cards">
          {card("用户", String(overview.users.total), `${overview.users.admins} 名管理员`)}
          {card("对话", String(overview.runs.total), `${overview.runs.live} 个进行中`)}
          {card("本月 token", overview.tokens.usedMonth.toLocaleString(), overview.quota.maxTokensMonth > 0 ? `额度 ${overview.quota.usedTokensMonth}/${overview.quota.maxTokensMonth}` : "未设上限")}
          {card("VM", overview.capacity.total ? `${overview.capacity.busy}/${overview.capacity.total}` : "未启用", overview.capacity.backend)}
          {card("限流", overview.rateLimit.enabled ? "已开启" : "已关闭", overview.rateLimit.store)}
          {card("模型", overview.llm.configured ? overview.llm.upstream : "未配置", overview.llm.model ?? undefined)}
        </div>
      ) : (
        <p className="muted">正在读取…</p>
      )}

      <section className="block">
        <h2>用户</h2>
        <p className="muted">按占用排序。密码不会出现在这里。对话页账号和这里是同一套用户库，但入口是分开的。</p>
        <table>
          <thead>
            <tr>
              <th>账号</th>
              <th>管理员</th>
              <th>对话</th>
              <th>本月 token</th>
              <th>进行中</th>
              <th>最近活跃</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.email}</strong>
                  <div className="muted">{user.orgId}</div>
                </td>
                <td>{user.admin ? "是" : "否"}</td>
                <td>{user.runCount}</td>
                <td>{user.usedTokensMonth.toLocaleString()}</td>
                <td>{user.concurrentRuns}</td>
                <td>{user.lastActiveAt ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="block">
        <h2>最近对话</h2>
        <table>
          <thead>
            <tr>
              <th>状态</th>
              <th>提示</th>
              <th>用户</th>
              <th>模型</th>
              <th>用量</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((item) => (
              <tr key={item.id}>
                <td>{STATUS[item.status] ?? item.status}</td>
                <td>{item.prompt.slice(0, 48)}</td>
                <td className="mono">{item.userId.slice(0, 8)}</td>
                <td>{item.model}</td>
                <td>{item.usage?.totalTokens ? `${item.usage.totalTokens} tok` : "—"}</td>
                <td>{item.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {overview ? (
        <section className="block">
          <h2>容量</h2>
          <p className="muted">
            {overview.capacity.total ? `${overview.capacity.backend} · ${overview.capacity.busy}/${overview.capacity.total} 忙碌` : "当前运行时没有 VM 槽。"}
            {` · 定时任务 ${overview.counts.automations} · 项目 ${overview.counts.projects} · 快照 ${overview.counts.builds}`}
          </p>
        </section>
      ) : null}

      <section className="block">
        <h2>限流</h2>
        <p className="muted">只读快照。改阈值请改环境变量。</p>
        {limits ? (
          <table>
            <thead>
              <tr>
                <th>策略</th>
                <th>类型</th>
                <th>剩余</th>
                <th>上限</th>
                <th>窗口</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(limits.policies).map(([name, policy]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{policy.kind}</td>
                  <td>{policy.remaining}</td>
                  <td>{policy.limit}</td>
                  <td>{Math.round(policy.windowMs / 1000)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">还没有限流快照。</p>
        )}
      </section>

      {overview ? (
        <section className="block">
          <h2>模型 / New API</h2>
          <p className="muted">渠道和定价在 New API。Neo 管理台不改渠道。</p>
          <p>
            上游 {overview.llm.configured ? overview.llm.upstream : "未配置"}
            {overview.llm.model ? ` · ${overview.llm.model}` : ""}
          </p>
          <p>
            {overview.newApi.consoleUrl || overview.newApi.url ? (
              <a href={overview.newApi.consoleUrl || overview.newApi.url || undefined} target="_blank" rel="noreferrer">
                打开 New API 控制台
              </a>
            ) : (
              "未配置 NEW_API_CONSOLE_URL"
            )}
          </p>
        </section>
      ) : null}

      {overview ? (
        <section className="block">
          <h2>系统</h2>
          <p className="muted">
            元数据 {overview.platform.metadataStore} · 事件 {overview.platform.eventBus} · 运行时 {overview.platform.workerRuntime} · 限流 {overview.rateLimit.store}
          </p>
        </section>
      ) : null}
    </div>
  );
}

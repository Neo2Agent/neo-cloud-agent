import { useEffect, useState } from "react";
import { api, readJson } from "../api";
import { formatUsage, formatWhen, preview, STATUS_LABELS } from "../format";

type AdminOverview = {
  users: { total: number; admins: number };
  runs: { total: number; live: number; byStatus: Record<string, number> };
  tokens: { usedMonth: number };
  quota: {
    maxTokensMonth: number;
    maxConcurrentRuns: number;
    usedTokensMonth: number;
    concurrentRuns: number;
  };
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
  createdAt: string;
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
  source: string;
  updatedAt: string;
  usage?: { totalTokens?: number } | null;
};

type RateLimitSnapshot = {
  enabled: boolean;
  store: string;
  policies: Record<string, { ok: boolean; remaining: number; limit: number; windowMs: number; kind: string }>;
};

type Props = {
  token: string;
  onOpenRun?: (id: string) => void;
};

function card(label: string, value: string, hint?: string) {
  return (
    <div className="admin-card" key={label}>
      <p className="admin-card-label">{label}</p>
      <p className="admin-card-value">{value}</p>
      {hint ? <p className="admin-card-hint">{hint}</p> : null}
    </div>
  );
}

export function AdminPage({ token, onOpenRun }: Props) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [runs, setRuns] = useState<AdminRun[]>([]);
  const [limits, setLimits] = useState<RateLimitSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setError("");
    const [overviewRes, usersRes, runsRes, limitsRes] = await Promise.all([
      api(token, "/v1/admin/overview"),
      api(token, "/v1/admin/users"),
      api(token, "/v1/admin/runs?limit=50"),
      api(token, "/v1/rate-limits"),
    ]);
    if (overviewRes.status === 403 || usersRes.status === 403) {
      throw new Error("需要平台管理员");
    }
    if (!overviewRes.ok) throw new Error("读取总览失败");
    if (!usersRes.ok) throw new Error("读取用户失败");
    if (!runsRes.ok) throw new Error("读取对话失败");
    setOverview(await readJson<AdminOverview>(overviewRes));
    setUsers((await readJson<{ users?: AdminUser[] }>(usersRes)).users ?? []);
    setRuns((await readJson<{ runs?: AdminRun[] }>(runsRes)).runs ?? []);
    if (limitsRes.ok) {
      setLimits(await readJson<RateLimitSnapshot>(limitsRes));
    }
  };

  useEffect(() => {
    setLoading(true);
    void refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "读取失败"))
      .finally(() => setLoading(false));
  }, [token]);

  const quotaHint = overview
    ? overview.quota.maxTokensMonth > 0
      ? `额度 ${overview.quota.usedTokensMonth}/${overview.quota.maxTokensMonth}`
      : "组织额度未设上限"
    : "";

  return (
    <section className="admin-page" id="admin-page">
      <header className="admin-page-head">
        <div>
          <p className="eyebrow">管理台</p>
          <h2>平台用量和限流</h2>
        </div>
        <div className="admin-head-actions">
          <p className="admin-count">{overview ? `${overview.users.total} 个用户` : "管理员"}</p>
          <button type="button" className="ghost" onClick={() => void refresh().catch((err) => setError(err instanceof Error ? err.message : "刷新失败"))}>
            刷新
          </button>
        </div>
      </header>

      {error ? <p className="admin-error">{error}</p> : null}
      {loading && !overview ? <p className="admin-muted">正在读取…</p> : null}

      {overview ? (
        <div className="admin-cards">
          {card("用户", String(overview.users.total), `${overview.users.admins} 名管理员`)}
          {card("对话", String(overview.runs.total), `${overview.runs.live} 个进行中`)}
          {card("本月 token", overview.tokens.usedMonth.toLocaleString(), quotaHint)}
          {card(
            "VM",
            overview.capacity.total ? `${overview.capacity.busy}/${overview.capacity.total}` : "未启用",
            overview.capacity.backend,
          )}
          {card("限流", overview.rateLimit.enabled ? "已开启" : "已关闭", overview.rateLimit.store)}
          {card("模型", overview.llm.configured ? overview.llm.upstream : "未配置", overview.llm.model ?? undefined)}
        </div>
      ) : null}

      <section className="admin-block">
        <h3 className="admin-card-title">用户</h3>
        <p className="admin-muted">按占用排序。密码不会出现在这里。本版不能停用账号。</p>
        <div className="admin-table-wrap">
          <table className="admin-table">
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
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6}>还没有用户</td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.email}</strong>
                      <div className="admin-sub">{user.orgId}</div>
                    </td>
                    <td>{user.admin ? "是" : "否"}</td>
                    <td>{user.runCount}</td>
                    <td>{user.usedTokensMonth.toLocaleString()}</td>
                    <td>{user.concurrentRuns}</td>
                    <td>{user.lastActiveAt ? formatWhen(user.lastActiveAt) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-block">
        <h3 className="admin-card-title">最近对话</h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>状态</th>
                <th>提示</th>
                <th>用户</th>
                <th>模型</th>
                <th>用量</th>
                <th>更新</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={7}>还没有对话</td>
                </tr>
              ) : (
                runs.map((item) => (
                  <tr key={item.id}>
                    <td>{STATUS_LABELS[item.status] ?? item.status}</td>
                    <td>{preview(item.prompt)}</td>
                    <td className="admin-mono">{item.userId.slice(0, 8)}</td>
                    <td>{item.model}</td>
                    <td>{formatUsage(item.usage) || "—"}</td>
                    <td>{formatWhen(item.updatedAt)}</td>
                    <td>
                      {onOpenRun ? (
                        <button type="button" className="ghost" onClick={() => onOpenRun(item.id)}>
                          打开
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {overview ? (
        <section className="admin-block">
          <h3 className="admin-card-title">容量</h3>
          <p className="admin-muted">
            {overview.capacity.total
              ? `${overview.capacity.backend} · ${overview.capacity.busy}/${overview.capacity.total} 忙碌`
              : "当前运行时没有 VM 槽。"}
            {` · 定时任务 ${overview.counts.automations} · 项目 ${overview.counts.projects} · 快照 ${overview.counts.builds}`}
          </p>
          {overview.capacity.slots.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>槽</th>
                    <th>状态</th>
                    <th>对话</th>
                    <th>已挂载</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.capacity.slots.map((slot) => (
                    <tr key={slot.id}>
                      <td className="admin-mono">{slot.id}</td>
                      <td>{slot.status}</td>
                      <td>
                        {slot.runId && onOpenRun ? (
                          <button type="button" className="ghost" onClick={() => onOpenRun(slot.runId!)}>
                            {slot.runId.slice(0, 8)}
                          </button>
                        ) : (
                          slot.runId ?? "—"
                        )}
                      </td>
                      <td>{slot.mounted ? "是" : "否"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="admin-block">
        <h3 className="admin-card-title">限流</h3>
        <p className="admin-muted">只读快照。改阈值请改环境变量，不在页面里写 Redis。</p>
        {limits ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
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
          </div>
        ) : (
          <p className="admin-muted">还没有限流快照。</p>
        )}
      </section>

      {overview ? (
        <section className="admin-block">
          <h3 className="admin-card-title">模型 / New API</h3>
          <p className="admin-muted">
            Neo 管 Agent 用户和 Run JWT。渠道、密钥、定价在 New API。Worker 不能持有 `sk-`。
          </p>
          <dl className="admin-dl">
            <div>
              <dt>当前上游</dt>
              <dd>
                {overview.llm.configured ? overview.llm.upstream : "未配置"}
                {overview.llm.model ? ` · ${overview.llm.model}` : ""}
              </dd>
            </div>
            <div>
              <dt>Base URL</dt>
              <dd className="admin-mono">{overview.llm.baseUrl || "默认"}</dd>
            </div>
            <div>
              <dt>New API</dt>
              <dd>
                {overview.newApi.consoleUrl || overview.newApi.url ? (
                  <a href={overview.newApi.consoleUrl || overview.newApi.url || undefined} target="_blank" rel="noreferrer">
                    打开控制台
                  </a>
                ) : (
                  "未配置 NEW_API_CONSOLE_URL"
                )}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {overview ? (
        <section className="admin-block">
          <h3 className="admin-card-title">系统</h3>
          <dl className="admin-dl">
            <div>
              <dt>元数据</dt>
              <dd>{overview.platform.metadataStore}</dd>
            </div>
            <div>
              <dt>事件总线</dt>
              <dd>{overview.platform.eventBus}</dd>
            </div>
            <div>
              <dt>运行时</dt>
              <dd>{overview.platform.workerRuntime}</dd>
            </div>
            <div>
              <dt>限流存储</dt>
              <dd>{overview.rateLimit.store}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </section>
  );
}

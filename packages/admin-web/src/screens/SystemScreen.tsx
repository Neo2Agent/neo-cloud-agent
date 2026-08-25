import { formatWindow, policyLabel } from "../format";
import type { AdminOverview, RateLimitSnapshot } from "../types";

type Props = {
  overview: AdminOverview;
  limits: RateLimitSnapshot | null;
};

export function SystemScreen({ overview, limits }: Props) {
  const policies = Object.entries(limits?.policies ?? {});
  const consoleUrl = overview.newApi.consoleUrl || overview.newApi.url;
  return (
    <div className="stack">
      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>运行时</h2>
            <p className="muted">管理台只读，不改渠道和密钥。</p>
          </div>
        </header>
        <dl className="facts facts-wide">
          <div>
            <dt>元数据</dt>
            <dd>{overview.platform.metadataStore}</dd>
          </div>
          <div>
            <dt>事件</dt>
            <dd>{overview.platform.eventBus}</dd>
          </div>
          <div>
            <dt>运行时</dt>
            <dd>{overview.platform.workerRuntime}</dd>
          </div>
          <div>
            <dt>限流</dt>
            <dd>
              {overview.rateLimit.enabled ? "已开启" : "已关闭"} · {overview.rateLimit.store}
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>模型 / New API</h2>
            <p className="muted">渠道和定价在 New API。这里只给入口。</p>
          </div>
        </header>
        <p className="body">
          上游 {overview.llm.configured ? overview.llm.upstream : "未配置"}
          {overview.llm.model ? ` · ${overview.llm.model}` : ""}
        </p>
        {consoleUrl ? (
          <a className="link-btn" href={consoleUrl} target="_blank" rel="noreferrer">
            打开 New API 控制台
          </a>
        ) : (
          <p className="muted">未配置 NEW_API_CONSOLE_URL</p>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>限流快照</h2>
            <p className="muted">改阈值请改环境变量，这里不能写。</p>
          </div>
        </header>
        {policies.length === 0 ? (
          <p className="muted">还没有限流快照。</p>
        ) : (
          <ul className="limit-list">
            {policies.map(([name, policy]) => {
              const used = Math.max(0, policy.limit - policy.remaining);
              const percent = policy.limit > 0 ? Math.min(100, Math.round((used / policy.limit) * 100)) : 0;
              return (
                <li key={name} className="limit-row">
                  <div className="limit-copy">
                    <strong>{policyLabel(name)}</strong>
                    <span className="muted">
                      {policy.kind === "concurrency" ? "并发" : "配额"} · {formatWindow(policy.windowMs)}
                    </span>
                  </div>
                  <div className="limit-meter">
                    <span>
                      {policy.remaining}/{policy.limit}
                    </span>
                    <div className="bar thin">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

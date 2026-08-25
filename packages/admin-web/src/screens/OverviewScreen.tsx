import { formatCount, formatTokens, formatWhen, quotaPercent, slotBusy, slotLabel, statusLabel, statusTone } from "../format";
import type { AdminOverview, AdminRun } from "../types";

type Props = {
  overview: AdminOverview;
  runs: AdminRun[];
};

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="metric">
      <p className="eyebrow">{label}</p>
      <p className="value">{value}</p>
      {hint ? <p className="muted">{hint}</p> : null}
    </article>
  );
}

export function OverviewScreen({ overview, runs }: Props) {
  const quota = overview.quota;
  const used = quota.usedTokensMonth || overview.tokens.usedMonth;
  const max = quota.maxTokensMonth;
  const percent = quotaPercent(used, max);
  const liveRuns = runs.filter((item) => statusTone(item.status) === "run" || item.status === "WAITING_FOR_BACKGROUND_WORK").slice(0, 4);

  return (
    <div className="stack">
      <section className="metrics">
        <Metric label="用户" value={formatCount(overview.users.total)} hint={`${overview.users.admins} 名管理员`} />
        <Metric label="对话" value={formatCount(overview.runs.total)} hint={`${overview.runs.live} 个进行中`} />
        <Metric
          label="本月 token"
          value={formatTokens(overview.tokens.usedMonth)}
          hint={max > 0 ? `额度 ${formatTokens(used)} / ${formatTokens(max)}` : "未设上限"}
        />
        <Metric
          label="虚拟机"
          value={overview.capacity.total ? `${overview.capacity.busy}/${overview.capacity.total}` : "—"}
          hint={overview.capacity.backend || "未启用"}
        />
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>本月额度</h2>
            <p className="muted">{max > 0 ? `已用 ${percent}%` : "没有配置月度上限"}</p>
          </div>
          <strong>{max > 0 ? `${formatTokens(used)} / ${formatTokens(max)}` : formatTokens(used)}</strong>
        </header>
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${max > 0 ? percent : Math.min(100, used ? 12 : 0)}%` }} />
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>容量</h2>
            <p className="muted">
              {overview.capacity.total
                ? `${overview.capacity.backend} · ${overview.capacity.busy}/${overview.capacity.total} 忙碌`
                : "当前运行时没有虚拟机槽"}
            </p>
          </div>
        </header>
        {overview.capacity.slots.length > 0 ? (
          <div className="chips">
            {overview.capacity.slots.map((slot) => (
              <span key={slot.id} className={`chip ${slotBusy(slot.status) ? "chip-run" : slot.mounted ? "chip-ok" : "chip-muted"}`}>
                {slotLabel(slot.id)}
                <em>{slotBusy(slot.status) ? "忙碌" : slot.mounted ? "空闲" : slot.status}</em>
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">没有可显示的槽位。</p>
        )}
        <dl className="facts">
          <div>
            <dt>定时任务</dt>
            <dd>{formatCount(overview.counts.automations)}</dd>
          </div>
          <div>
            <dt>项目</dt>
            <dd>{formatCount(overview.counts.projects)}</dd>
          </div>
          <div>
            <dt>快照</dt>
            <dd>{formatCount(overview.counts.builds)}</dd>
          </div>
          <div>
            <dt>环境</dt>
            <dd>{formatCount(overview.counts.environments)}</dd>
          </div>
          <div>
            <dt>Desk</dt>
            <dd>{formatCount(overview.counts.desks)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>进行中的对话</h2>
            <p className="muted">{liveRuns.length ? "只看还在跑的" : "现在没有进行中的对话"}</p>
          </div>
        </header>
        {liveRuns.length ? (
          <ul className="cards">
            {liveRuns.map((item) => (
              <li key={item.id} className="row-card">
                <div className="row-card-top">
                  <span className={`status status-${statusTone(item.status)}`}>{statusLabel(item.status)}</span>
                  <time>{formatWhen(item.updatedAt)}</time>
                </div>
                <strong>{item.prompt.slice(0, 72) || "未命名任务"}</strong>
                <p className="muted">
                  {item.model || "默认模型"} · {item.usage?.totalTokens ? `${formatTokens(item.usage.totalTokens)} tok` : "还没有用量"}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

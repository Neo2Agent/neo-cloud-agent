import { formatCount, formatTokens, formatWhen, quotaPercent, slotBusy, slotLabel, statusLabel, statusTone } from "../format";
import { isLiveStatus, snippet } from "../catalog";
import { CatalogEmpty, CatalogList, CatalogRow } from "../components/Catalog";
import type { AdminOverview, AdminRun } from "../types";

type Props = {
  overview: AdminOverview;
  runs: AdminRun[];
  onOpenRun: (id: string) => void;
  onOpenUsers: () => void;
  onOpenRuns: () => void;
};

function Metric({
  label,
  value,
  hint,
  onOpen,
}: {
  label: string;
  value: string;
  hint?: string;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <p className="eyebrow">{label}</p>
      <p className="value">{value}</p>
      {hint ? <p className="hint">{hint}</p> : null}
    </>
  );
  if (onOpen) {
    return (
      <button type="button" className="metric metric-btn" onClick={onOpen}>
        {inner}
      </button>
    );
  }
  return <article className="metric">{inner}</article>;
}

export function OverviewScreen({ overview, runs, onOpenRun, onOpenUsers, onOpenRuns }: Props) {
  const quota = overview.quota;
  const used = quota.usedTokensMonth || overview.tokens.usedMonth;
  const max = quota.maxTokensMonth;
  const percent = quotaPercent(used, max);
  const liveRuns =
    overview.liveRuns ??
    runs.filter((item) => isLiveStatus(item.status)).slice(0, 6);

  return (
    <section className="page catalog-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">总览</p>
          <h2>用量和容量</h2>
          <p className="hint">指标能点进去。进行中的对话直接打开详情。</p>
        </div>
      </header>

      <section className="metric-grid">
        <Metric label="用户" value={formatCount(overview.users.total)} hint={`${overview.users.admins} 名管理员`} onOpen={onOpenUsers} />
        <Metric label="对话" value={formatCount(overview.runs.total)} hint={`${overview.runs.live} 个进行中`} onOpen={onOpenRuns} />
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
            <h3>本月额度</h3>
            <p className="hint">{max > 0 ? `已用 ${percent}%` : "没有配置月度上限"}</p>
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
            <h3>容量</h3>
            <p className="hint">
              {overview.capacity.total
                ? `${overview.capacity.backend} · ${overview.capacity.busy}/${overview.capacity.total} 忙碌`
                : "当前运行时没有虚拟机槽"}
            </p>
          </div>
        </header>
        {overview.capacity.slots.length > 0 ? (
          <div className="vm-rail overview-slots">
            {overview.capacity.slots.map((slot) => (
              <article
                key={slot.id}
                className="vm-slot"
                data-busy={String(slotBusy(slot.status))}
                data-held={String(slot.mounted && !slotBusy(slot.status))}
              >
                <strong>{slotLabel(slot.id)}</strong>
                <small>{slotBusy(slot.status) ? "忙碌" : slot.mounted ? "空闲" : slot.status}</small>
              </article>
            ))}
          </div>
        ) : (
          <p className="hint">没有可显示的槽位。</p>
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

      <section className="catalog-panel">
        <header className="panel-head">
          <div>
            <h3>进行中的对话</h3>
            <p className="hint">{liveRuns.length ? "点进去看内容和占用" : "现在没有进行中的对话"}</p>
          </div>
        </header>
        {liveRuns.length ? (
          <CatalogList>
            {liveRuns.map((item) => (
              <CatalogRow
                key={item.id}
                title={snippet(item.title || item.prompt, 48) || "未命名任务"}
                badge={statusLabel(item.status)}
                badgeTone={statusTone(item.status)}
                description={[item.userEmail || item.userId, item.model].filter(Boolean).join(" · ")}
                meta={`${item.usage?.totalTokens ? `${formatTokens(item.usage.totalTokens)} tok · ` : ""}${formatWhen(item.updatedAt)}`}
                onOpen={() => onOpenRun(item.id)}
              />
            ))}
          </CatalogList>
        ) : (
          <CatalogEmpty title="现在没有进行中的对话" hint="新开的任务会先出现在这里。" />
        )}
      </section>
    </section>
  );
}

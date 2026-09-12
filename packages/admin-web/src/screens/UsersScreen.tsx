import { useEffect, useMemo, useState } from "react";
import { api, readJson } from "../api";
import { clampPage, defaultUserTab, filterByQuery, filterUsersByTab, paginate, snippet } from "../catalog";
import { CatalogEmpty, CatalogList, CatalogPager, CatalogRow, CatalogTabs, CatalogToolbar } from "../components/Catalog";
import { formatCount, formatTokens, formatWhen, statusLabel, statusTone } from "../format";
import { IconBack } from "../icons";
import type { AdminRun, AdminUser } from "../types";

type Props = {
  token: string;
  users: AdminUser[] | null;
  selectedId: string;
  tab: string;
  approvingId?: string;
  onApprove?: (id: string) => void;
  onTab: (tab: string) => void;
  onOpen: (id: string) => void;
  onBack: () => void;
  onOpenRun: (id: string) => void;
};

function yuan(fen: number): string {
  return `¥${(Math.max(0, fen) / 100).toFixed(2)}`;
}

function statusBadge(user: AdminUser): string {
  if (user.status === "pending") return "待审核";
  if (user.status === "disabled") return "已停用";
  return user.admin ? "管理员" : "已通过";
}

export function UsersScreen({
  token,
  users,
  selectedId,
  tab,
  approvingId,
  onApprove,
  onTab,
  onOpen,
  onBack,
  onOpenRun,
}: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AdminUser | null>(null);
  const [detailRuns, setDetailRuns] = useState<AdminRun[]>([]);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);

  const list = users ?? [];
  const pendingCount = list.filter((user) => user.status === "pending").length;
  const activeTab = tab || defaultUserTab(list);
  const scoped = filterUsersByTab(list, activeTab);
  const filtered = useMemo(
    () =>
      filterByQuery(scoped, query, (user) => [
        user.email,
        user.phone ?? "",
        user.orgId,
        user.status ?? "",
        user.admin ? "管理员" : "成员",
      ]),
    [query, scoped],
  );
  const listPage = clampPage(page, filtered.length);
  const visible = paginate(filtered, listPage);

  useEffect(() => {
    setPage(1);
  }, [query, activeTab]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailRuns([]);
      setDetailError("");
      return;
    }
    const cached = list.find((user) => user.id === selectedId) ?? null;
    if (cached) setDetail(cached);
    setDetailLoading(true);
    setDetailError("");
    void (async () => {
      const response = await api(token, `/v1/admin/users/${encodeURIComponent(selectedId)}`);
      const body = await readJson<{ user?: AdminUser; runs?: AdminRun[]; error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "读取用户失败");
      if (body.user) setDetail(body.user);
      setDetailRuns(body.runs ?? []);
    })()
      .catch((err) => setDetailError(err instanceof Error ? err.message : "读取用户失败"))
      .finally(() => setDetailLoading(false));
  }, [list, selectedId, token]);

  if (selectedId) {
    const user = detail;
    return (
      <section className="page catalog-page">
        <header className="page-head">
          <div>
            <button type="button" className="catalog-back" onClick={onBack}>
              <IconBack />
              全部用户
            </button>
            <h2>{user?.email ?? "用户详情"}</h2>
            <p className="hint">{user ? `${user.orgId} · ${statusBadge(user)}` : "正在读取账号占用。"}</p>
          </div>
          {user?.status === "pending" && onApprove ? (
            <button type="button" className="primary-btn" disabled={approvingId === user.id} onClick={() => onApprove(user.id)}>
              {approvingId === user.id ? "通过中…" : "通过审核"}
            </button>
          ) : null}
        </header>
        {detailError ? <p className="banner">{detailError}</p> : null}
        {user ? (
          <section className="panel">
            <dl className="facts facts-wide">
              <div>
                <dt>状态</dt>
                <dd>{statusBadge(user)}</dd>
              </div>
              <div>
                <dt>额度</dt>
                <dd>{yuan(user.creditFen ?? 0)}</dd>
              </div>
              <div>
                <dt>对话</dt>
                <dd>{formatCount(user.runCount)}</dd>
              </div>
              <div>
                <dt>本月 token</dt>
                <dd>{formatTokens(user.usedTokensMonth)}</dd>
              </div>
              <div>
                <dt>进行中</dt>
                <dd>{formatCount(user.concurrentRuns)}</dd>
              </div>
              <div>
                <dt>最近活跃</dt>
                <dd>{formatWhen(user.lastActiveAt)}</dd>
              </div>
              {user.phone ? (
                <div>
                  <dt>手机号</dt>
                  <dd>{user.phone}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}
        <section className="catalog-panel">
          <header className="panel-head">
            <div>
              <h3>这个人的对话</h3>
              <p className="hint">{detailLoading ? "正在读取…" : `${detailRuns.length} 条`}</p>
            </div>
          </header>
          {detailRuns.length === 0 ? (
            <CatalogEmpty title={detailLoading ? "正在读取对话…" : "这个账号还没有对话"} />
          ) : (
            <CatalogList>
              {detailRuns.map((item) => (
                <CatalogRow
                  key={item.id}
                  title={snippet(item.title || item.prompt, 56) || "未命名任务"}
                  badge={statusLabel(item.status)}
                  badgeTone={statusTone(item.status)}
                  description={item.model}
                  meta={`${item.usage?.totalTokens ? `${formatTokens(item.usage.totalTokens)} tok · ` : ""}${formatWhen(item.updatedAt)}`}
                  onOpen={() => onOpenRun(item.id)}
                />
              ))}
            </CatalogList>
          )}
        </section>
      </section>
    );
  }

  if (users === null) {
    return (
      <section className="page catalog-page">
        <div className="skeleton panel" />
        <div className="skeleton panel" />
      </section>
    );
  }

  return (
    <section className="page catalog-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">用户</p>
          <h2>谁在占用平台</h2>
          <p className="hint">公开注册先待审。点进账号看额度和对话。</p>
        </div>
        <p className="count-pill">{filtered.length} 人</p>
      </header>

      <CatalogTabs
        tabs={[
          { id: "pending", label: "待审核", count: pendingCount },
          { id: "active", label: "已通过", count: list.filter((user) => (user.status ?? "active") === "active").length },
          { id: "all", label: "全部", count: list.length },
        ]}
        active={activeTab}
        onChange={onTab}
      />
      <CatalogToolbar search={query} onSearch={setQuery} placeholder="搜索账号、手机号或组织" />

      {filtered.length === 0 ? (
        <CatalogEmpty
          title={scoped.length === 0 ? (activeTab === "pending" ? "没有待审用户" : "还没有用户") : "没有匹配的用户"}
          hint={activeTab === "pending" ? "有人注册之后会出现在这里。" : "换个账号或组织再试试。"}
        />
      ) : (
        <>
          <CatalogList>
            {visible.map((user) => (
              <CatalogRow
                key={user.id}
                title={user.email}
                badge={statusBadge(user)}
                description={snippet(
                  [user.phone, user.status === "pending" ? "待审" : null, user.creditFen ? yuan(user.creditFen) : null, user.orgId]
                    .filter(Boolean)
                    .join(" · "),
                  64,
                )}
                meta={`${formatCount(user.runCount)} 对话 · 本月 ${formatTokens(user.usedTokensMonth)} · 进行中 ${formatCount(user.concurrentRuns)} · ${formatWhen(user.lastActiveAt)}`}
                onOpen={() => onOpen(user.id)}
                actions={
                  user.status === "pending" && onApprove ? (
                    <button type="button" className="ghost" disabled={approvingId === user.id} onClick={() => onApprove(user.id)}>
                      {approvingId === user.id ? "通过中…" : "通过"}
                    </button>
                  ) : null
                }
              />
            ))}
          </CatalogList>
          <CatalogPager page={listPage} total={filtered.length} onPage={setPage} />
        </>
      )}
    </section>
  );
}

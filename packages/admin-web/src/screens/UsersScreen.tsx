import { useEffect, useMemo, useState } from "react";
import { clampPage, filterByQuery, paginate, snippet } from "../catalog";
import { CatalogCard, CatalogEmpty, CatalogGrid, CatalogPager, CatalogTabs, CatalogToolbar } from "../components/Catalog";
import { formatCount, formatTokens, formatWhen } from "../format";
import type { AdminUser } from "../types";

type Tab = "pending" | "all";

function yuan(fen: number): string {
  return `¥${(Math.max(0, fen) / 100).toFixed(2)}`;
}

type Props = {
  users: AdminUser[];
  approvingId?: string;
  onApprove?: (id: string) => void;
};

export function UsersScreen({ users, approvingId, onApprove }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>("pending");
  const pendingCount = users.filter((user) => user.status === "pending").length;
  const scoped = tab === "pending" ? users.filter((user) => user.status === "pending") : users;
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
  }, [query, tab]);

  return (
    <section className="page catalog-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">用户</p>
          <h2>谁在占用平台</h2>
          <p className="hint">公开注册先待审。通过后才能登录，起步额度 ¥5.00。</p>
        </div>
        <p className="count-pill">{filtered.length} 人</p>
      </header>

      <CatalogTabs
        tabs={[
          { id: "pending", label: "待审核", count: pendingCount },
          { id: "all", label: "全部", count: users.length },
        ]}
        active={tab}
        onChange={setTab}
      />
      <CatalogToolbar search={query} onSearch={setQuery} placeholder="搜索账号、手机号或组织" />

      {filtered.length === 0 ? (
        <CatalogEmpty
          title={scoped.length === 0 ? (tab === "pending" ? "没有待审用户" : "还没有用户") : "没有匹配的用户"}
          hint={tab === "pending" ? "有人注册之后会出现在这里。" : "换个账号或组织再试试。"}
        />
      ) : (
        <>
          <CatalogGrid>
            {visible.map((user) => (
              <CatalogCard
                key={user.id}
                title={user.email}
                badge={user.status === "pending" ? "待审核" : user.admin ? "管理员" : "成员"}
                description={snippet(
                  [user.phone, user.status === "pending" ? "待审" : null, user.creditFen ? yuan(user.creditFen) : null, user.orgId]
                    .filter(Boolean)
                    .join(" · "),
                  64,
                )}
                meta={`${formatCount(user.runCount)} 对话 · 本月 ${formatTokens(user.usedTokensMonth)} · 进行中 ${formatCount(user.concurrentRuns)} · ${formatWhen(user.lastActiveAt)}`}
                actions={
                  user.status === "pending" && onApprove ? (
                    <button type="button" className="ghost" disabled={approvingId === user.id} onClick={() => onApprove(user.id)}>
                      {approvingId === user.id ? "通过中…" : "通过"}
                    </button>
                  ) : null
                }
              />
            ))}
          </CatalogGrid>
          <CatalogPager page={listPage} total={filtered.length} onPage={setPage} />
        </>
      )}
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import { clampPage, filterByQuery, paginate, snippet } from "../catalog";
import { CatalogCard, CatalogEmpty, CatalogGrid, CatalogPager, CatalogToolbar } from "../components/Catalog";
import { formatCount, formatTokens, formatWhen } from "../format";
import type { AdminUser } from "../types";

type Props = {
  users: AdminUser[];
};

export function UsersScreen({ users }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(
    () => filterByQuery(users, query, (user) => [user.email, user.orgId, user.admin ? "管理员" : "成员"]),
    [query, users],
  );
  const listPage = clampPage(page, filtered.length);
  const visible = paginate(filtered, listPage);

  useEffect(() => {
    setPage(1);
  }, [query]);

  return (
    <section className="page catalog-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">用户</p>
          <h2>谁在占用平台</h2>
          <p className="hint">按占用排序，密码不会出现在这里。</p>
        </div>
        <p className="count-pill">{filtered.length} 人</p>
      </header>

      <CatalogToolbar search={query} onSearch={setQuery} placeholder="搜索账号或组织" />

      {filtered.length === 0 ? (
        <CatalogEmpty
          title={users.length === 0 ? "还没有用户" : "没有匹配的用户"}
          hint={users.length === 0 ? "有人登录之后会出现在这里。" : "换个账号或组织再试试。"}
        />
      ) : (
        <>
          <CatalogGrid>
            {visible.map((user) => (
              <CatalogCard
                key={user.id}
                title={user.email}
                badge={user.admin ? "管理员" : "成员"}
                description={snippet(user.orgId, 48)}
                meta={`${formatCount(user.runCount)} 对话 · 本月 ${formatTokens(user.usedTokensMonth)} · 进行中 ${formatCount(user.concurrentRuns)} · ${formatWhen(user.lastActiveAt)}`}
              />
            ))}
          </CatalogGrid>
          <CatalogPager page={listPage} total={filtered.length} onPage={setPage} />
        </>
      )}
    </section>
  );
}

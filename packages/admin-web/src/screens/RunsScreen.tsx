import { useEffect, useMemo, useState } from "react";
import { clampPage, filterByQuery, paginate, snippet } from "../catalog";
import { CatalogCard, CatalogEmpty, CatalogGrid, CatalogPager, CatalogToolbar } from "../components/Catalog";
import { formatTokens, formatWhen, sourceLabel, statusLabel } from "../format";
import type { AdminRun } from "../types";

type Props = {
  runs: AdminRun[];
};

export function RunsScreen({ runs }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(
    () =>
      filterByQuery(runs, query, (item) => [
        item.prompt,
        item.status,
        statusLabel(item.status),
        item.model,
        item.userId,
        item.source,
        sourceLabel(item.source),
      ]),
    [query, runs],
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
          <p className="eyebrow">对话</p>
          <h2>全平台最近对话</h2>
          <p className="hint">最近 50 条，全平台可见。</p>
        </div>
        <p className="count-pill">{filtered.length} 条</p>
      </header>

      <CatalogToolbar search={query} onSearch={setQuery} placeholder="搜索提示、状态或模型" />

      {filtered.length === 0 ? (
        <CatalogEmpty
          title={runs.length === 0 ? "还没有对话" : "没有匹配的对话"}
          hint={runs.length === 0 ? "用户开对话之后会出现在这里。" : "换个关键词再试试。"}
        />
      ) : (
        <>
          <CatalogGrid>
            {visible.map((item) => (
              <CatalogCard
                key={item.id}
                title={snippet(item.prompt, 56) || "未命名任务"}
                badge={statusLabel(item.status)}
                description={[sourceLabel(item.source) || "对话", item.model].filter(Boolean).join(" · ")}
                meta={`${item.usage?.totalTokens ? `${formatTokens(item.usage.totalTokens)} tok · ` : ""}${formatWhen(item.updatedAt)}`}
              />
            ))}
          </CatalogGrid>
          <CatalogPager page={listPage} total={filtered.length} onPage={setPage} />
        </>
      )}
    </section>
  );
}

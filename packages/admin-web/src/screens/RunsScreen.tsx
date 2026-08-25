import { useMemo, useState } from "react";
import { formatTokens, formatWhen, preview, shortId, sourceLabel, statusLabel, statusTone } from "../format";
import type { AdminRun } from "../types";

type Props = {
  runs: AdminRun[];
};

export function RunsScreen({ runs }: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return runs;
    return runs.filter((item) => {
      const hay = [item.prompt, item.status, statusLabel(item.status), item.model, item.userId, item.source, sourceLabel(item.source)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [query, runs]);

  return (
    <div className="stack">
      <label className="search">
        <span className="sr-only">搜索对话</span>
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          placeholder="搜索提示、状态或模型"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {filtered.length === 0 ? (
        <div className="empty">没有匹配的对话。</div>
      ) : (
        <>
          <ul className="cards cards-only-narrow">
            {filtered.map((item) => (
              <li key={item.id} className="row-card">
                <div className="row-card-top">
                  <span className={`status status-${statusTone(item.status)}`}>{statusLabel(item.status)}</span>
                  <time>{formatWhen(item.updatedAt)}</time>
                </div>
                <strong>{preview(item.prompt)}</strong>
                <p className="muted">
                  {sourceLabel(item.source) || "对话"}
                  {item.model ? ` · ${item.model}` : ""}
                  {` · ${shortId(item.userId)}`}
                  {item.usage?.totalTokens ? ` · ${formatTokens(item.usage.totalTokens)} tok` : ""}
                </p>
              </li>
            ))}
          </ul>
          <div className="table-wrap table-only-wide">
            <table>
              <thead>
                <tr>
                  <th>状态</th>
                  <th>提示</th>
                  <th>来源</th>
                  <th>模型</th>
                  <th>用量</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className={`status status-${statusTone(item.status)}`}>{statusLabel(item.status)}</span>
                    </td>
                    <td>
                      <strong>{preview(item.prompt, 56)}</strong>
                      <div className="muted mono">{shortId(item.userId)}</div>
                    </td>
                    <td>{sourceLabel(item.source) || "—"}</td>
                    <td>{item.model || "—"}</td>
                    <td>{item.usage?.totalTokens ? `${formatTokens(item.usage.totalTokens)} tok` : "—"}</td>
                    <td>{formatWhen(item.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { formatCount, formatTokens, formatWhen } from "../format";
import type { AdminUser } from "../types";

type Props = {
  users: AdminUser[];
};

export function UsersScreen({ users }: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => user.email.toLowerCase().includes(needle) || user.orgId.toLowerCase().includes(needle));
  }, [query, users]);

  return (
    <div className="stack">
      <label className="search">
        <span className="sr-only">搜索用户</span>
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          placeholder="搜索账号或组织"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {filtered.length === 0 ? (
        <div className="empty">没有匹配的用户。</div>
      ) : (
        <>
          <ul className="cards cards-only-narrow">
            {filtered.map((user) => (
              <li key={user.id} className="row-card">
                <div className="row-card-top">
                  <span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span>
                  <div className="grow">
                    <strong>{user.email}</strong>
                    <p className="muted">{user.orgId}</p>
                  </div>
                  {user.admin ? <span className="chip chip-run">管理员</span> : <span className="chip chip-muted">成员</span>}
                </div>
                <dl className="mini-facts">
                  <div>
                    <dt>对话</dt>
                    <dd>{formatCount(user.runCount)}</dd>
                  </div>
                  <div>
                    <dt>本月</dt>
                    <dd>{formatTokens(user.usedTokensMonth)}</dd>
                  </div>
                  <div>
                    <dt>进行中</dt>
                    <dd>{formatCount(user.concurrentRuns)}</dd>
                  </div>
                </dl>
                <p className="muted">最近活跃 {formatWhen(user.lastActiveAt)}</p>
              </li>
            ))}
          </ul>
          <div className="table-wrap table-only-wide">
            <table>
              <thead>
                <tr>
                  <th>账号</th>
                  <th>角色</th>
                  <th>对话</th>
                  <th>本月 token</th>
                  <th>进行中</th>
                  <th>最近活跃</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.email}</strong>
                      <div className="muted">{user.orgId}</div>
                    </td>
                    <td>{user.admin ? "管理员" : "成员"}</td>
                    <td>{formatCount(user.runCount)}</td>
                    <td>{formatTokens(user.usedTokensMonth)}</td>
                    <td>{formatCount(user.concurrentRuns)}</td>
                    <td>{formatWhen(user.lastActiveAt)}</td>
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

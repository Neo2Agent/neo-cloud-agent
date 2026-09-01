import { useEffect, useMemo, useState } from "react";
import { api, readJson } from "../api";
import { clampPage, paginate, snippet } from "../catalog";
import { CatalogCard, CatalogEmpty, CatalogGrid, CatalogPager, CatalogToolbar } from "../components/Catalog";
import type { AdminMemory, AdminUser } from "../types";

type Props = {
  token: string;
  users: AdminUser[];
};

export function MemoriesScreen({ token, users }: Props) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [configured, setConfigured] = useState(true);
  const [items, setItems] = useState<AdminMemory[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.text.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle));
  }, [items, query]);
  const listPage = clampPage(page, filtered.length);
  const visible = paginate(filtered, listPage);

  const refresh = async (id: string) => {
    if (!token || !id) {
      setItems([]);
      return;
    }
    const response = await api(token, `/v1/admin/memories?userId=${encodeURIComponent(id)}`);
    const body = await readJson<{ configured?: boolean; memories?: AdminMemory[]; error?: string }>(response);
    if (body.error) throw new Error(body.error);
    setConfigured(body.configured !== false);
    setItems(body.memories ?? []);
    setError("");
  };

  useEffect(() => {
    if (!userId && users[0]?.id) setUserId(users[0].id);
  }, [userId, users]);

  useEffect(() => {
    void refresh(userId).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "加载记忆失败");
    });
  }, [token, userId]);

  useEffect(() => {
    setPage(1);
  }, [query, userId]);

  const remove = (id: string) => {
    if (!userId || busy || !window.confirm("删除这条记忆？")) return;
    setBusy(true);
    void api(token, `/v1/admin/memories/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    })
      .then(async (response) => {
        const body = await readJson<{ error?: string }>(response);
        if (!response.ok) throw new Error(body.error || "删除失败");
        setItems((prev) => prev.filter((item) => item.id !== id));
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "删除失败"))
      .finally(() => setBusy(false));
  };

  return (
    <section className="page catalog-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">记忆</p>
          <h2>按用户看记忆</h2>
          <p className="hint">
            {error
              ? error
              : !configured
                ? "记忆还没接上。"
                : userId
                  ? `这个用户 ${items.length} 条。删了用户那边也没了。`
                  : "先选一个用户。"}
          </p>
        </div>
        <label className="count-pill">
          <span className="sr-only">用户</span>
          <select value={userId} onChange={(event) => setUserId(event.target.value)}>
            {users.length === 0 ? <option value="">没有用户</option> : null}
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email}
              </option>
            ))}
          </select>
        </label>
      </header>

      <CatalogToolbar search={query} onSearch={setQuery} placeholder="搜索这条用户的记忆" />

      {filtered.length === 0 ? (
        <CatalogEmpty
          title={!configured ? "记忆还没接上" : items.length === 0 ? "这个用户还没有记忆" : "没有匹配的记忆"}
          hint={!configured ? "接上 Mem0 之后才会出现条目。" : "换个用户或关键词。"}
        />
      ) : (
        <>
          <CatalogGrid>
            {visible.map((item) => (
              <CatalogCard
                key={item.id}
                title={snippet(item.text, 72)}
                description={item.text.length > 72 ? item.text : undefined}
                initial="记"
                actions={
                  <button type="button" className="ghost" disabled={busy} onClick={() => remove(item.id)}>
                    删除
                  </button>
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

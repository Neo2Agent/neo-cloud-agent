import { useEffect, useMemo, useState } from "react";
import { api, readJson } from "../api";
import { clampPage, paginate, snippet } from "../catalog.js";
import { IconBack } from "../icons.js";
import { filterMemories, memoryHint, type MemoryRow } from "../memory";
import { CatalogCard, CatalogEmpty, CatalogForm, CatalogGrid, CatalogModal, CatalogPager, CatalogToolbar } from "./Catalog.js";

type Props = {
  token: string;
  onBack?: () => void;
};

export function MemoriesPage({ token, onBack }: Props) {
  const [configured, setConfigured] = useState(false);
  const [items, setItems] = useState<MemoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filtered = useMemo(() => filterMemories(items, query), [items, query]);
  const listPage = clampPage(page, filtered.length);
  const visible = paginate(filtered, listPage);

  const refresh = async () => {
    if (!token) return;
    const body = await readJson<{ configured?: boolean; memories?: MemoryRow[]; error?: string }>(
      await api(token, "/v1/memories"),
    );
    if (body.error) throw new Error(body.error);
    setConfigured(Boolean(body.configured));
    setItems((body.memories ?? []).filter((item) => item.id && item.text));
    setError("");
  };

  useEffect(() => {
    void refresh().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "加载记忆失败");
    });
  }, [token]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const add = () => {
    const text = draft.trim();
    if (!text || busy || !token) return;
    setBusy(true);
    void (async () => {
      const body = await readJson<{ memories?: MemoryRow[]; error?: string }>(
        await api(token, "/v1/memories", { method: "POST", body: JSON.stringify({ text }) }),
      );
      if (body.error) throw new Error(body.error);
      setDraft("");
      setCreateOpen(false);
      await refresh();
    })()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "记下失败");
      })
      .finally(() => setBusy(false));
  };

  const remove = (id: string) => {
    if (busy || !token || !window.confirm("删除这条记忆？")) return;
    setBusy(true);
    void (async () => {
      const body = await readJson<{ error?: string }>(
        await api(token, `/v1/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),
      );
      if (body.error) throw new Error(body.error);
      setItems((prev) => prev.filter((item) => item.id !== id));
    })()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "删除失败");
      })
      .finally(() => setBusy(false));
  };

  const hint = memoryHint({ configured, count: items.length, error: error || undefined });
  const emptyTitle = error ? "记忆打不开" : configured ? (items.length === 0 ? "还没有记忆" : "没有匹配的记忆") : "记忆还没接上";

  return (
    <section className="proj-page catalog-page" id="memories-page">
      <header className="proj-page-head">
        <div>
          {onBack ? (
            <button className="catalog-back" type="button" onClick={onBack}>
              <IconBack />
              返回对话
            </button>
          ) : (
            <p className="eyebrow">记忆</p>
          )}
          <h2>跨对话记住的事</h2>
          <p className="hint">{hint}</p>
        </div>
      </header>

      <CatalogToolbar
        search={query}
        onSearch={setQuery}
        placeholder="搜索记忆"
        actionLabel={configured ? "记一条" : undefined}
        onAction={
          configured
            ? () => {
                setDraft("");
                setCreateOpen(true);
              }
            : undefined
        }
      />

      {filtered.length === 0 ? (
        <CatalogEmpty
          title={emptyTitle}
          hint={items.length === 0 && configured && !error ? "对话里说「帮我记住」，或点右上角记一条。" : hint}
          action={
            configured && items.length === 0 && !error ? (
              <button
                className="proj-add"
                type="button"
                onClick={() => {
                  setDraft("");
                  setCreateOpen(true);
                }}
              >
                记一条
              </button>
            ) : null
          }
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

      <CatalogModal
        title="记一条"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" className="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button type="button" className="proj-add" disabled={busy || !draft.trim()} onClick={add}>
              保存
            </button>
          </>
        }
      >
        <CatalogForm
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <label>
            <span>内容</span>
            <textarea
              value={draft}
              rows={4}
              placeholder="例如：偏好 pnpm，不要 force push"
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
        </CatalogForm>
      </CatalogModal>
    </section>
  );
}

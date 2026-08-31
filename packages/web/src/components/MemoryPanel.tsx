import { useEffect, useMemo, useState } from "react";
import { api, readJson } from "../api";
import { IconTrash } from "../icons";
import { filterMemories, memoryHint, type MemoryRow } from "../memory";

type Props = {
  token: string;
};

export function MemoryPanel({ token }: Props) {
  const [configured, setConfigured] = useState(false);
  const [items, setItems] = useState<MemoryRow[]>([]);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = useMemo(() => filterMemories(items, query), [items, query]);

  const refresh = async () => {
    if (!token) return;
    try {
      const body = await readJson<{ configured?: boolean; memories?: MemoryRow[]; error?: string }>(
        await api(token, "/v1/memories"),
      );
      if (body.error) throw new Error(body.error);
      setConfigured(Boolean(body.configured));
      setItems((body.memories ?? []).filter((item) => item.id && item.text));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载记忆失败");
    }
  };

  useEffect(() => {
    void refresh();
  }, [token]);

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
      const body = await readJson<{ error?: string }>(await api(token, `/v1/memories/${encodeURIComponent(id)}`, { method: "DELETE" }));
      if (body.error) throw new Error(body.error);
      setItems((prev) => prev.filter((item) => item.id !== id));
    })()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "删除失败");
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="memory-block" id="memory-panel" aria-label="记忆">
      <p className="eyebrow">记忆</p>
      {configured ? (
        <div className="env-row memory-add">
          <label>
            <span>记一条</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="例如：偏好 pnpm"
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
          </label>
          <button className="ghost" type="button" disabled={busy || !draft.trim()} onClick={add}>
            保存
          </button>
        </div>
      ) : null}
      {items.length > 4 ? (
        <input
          type="search"
          className="run-search"
          placeholder="筛选记忆"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="筛选记忆"
        />
      ) : null}
      <p className="hint" id="memory-status">
        {memoryHint({ configured, count: items.length, error: error || undefined })}
      </p>
      {visible.length > 0 ? (
        <ul className="memory-list">
          {visible.map((item) => (
            <li key={item.id} className="memory-row">
              <span>{item.text}</span>
              <button type="button" className="pin run-delete" aria-label="删除这条记忆" disabled={busy} onClick={() => remove(item.id)}>
                <IconTrash size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

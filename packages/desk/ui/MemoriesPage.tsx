import { filterMemories, memoryHint, type MemoryItem } from "@neo-cloud-agent/contracts";
import { useEffect, useMemo, useState } from "react";
import { api, readJson } from "./api";
import { IconPlus } from "./icons";
import { IslandButton, IslandInput } from "./island";
import { Modal, Page } from "./pages";

type Props = {
  token: string;
};

export function MemoriesPage({ token }: Props) {
  const [configured, setConfigured] = useState(false);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filtered = useMemo(() => filterMemories(items, query), [items, query]);
  const hint = memoryHint({ configured, count: items.length, error: error || undefined });

  const refresh = async () => {
    const body = await readJson<{ configured?: boolean; memories?: MemoryItem[]; error?: string }>(
      await api(token, "/v1/memories?limit=50"),
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

  const add = () => {
    const text = draft.trim();
    if (!text || busy || !token) return;
    setBusy(true);
    void (async () => {
      const body = await readJson<{ memories?: MemoryItem[]; error?: string }>(
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

  return (
    <Page>
      <header className="dash-head">
        <div>
          <h1>记忆</h1>
          <p>{hint}</p>
        </div>
        {configured ? (
          <IslandButton
            type="primary"
            onClick={() => {
              setDraft("");
              setCreateOpen(true);
            }}
          >
            <IconPlus size={16} />
            记一条
          </IslandButton>
        ) : null}
      </header>
      <div className="page-body">
        <IslandInput
          value={query}
          placeholder="搜索记忆"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="搜索记忆"
        />
        {filtered.length === 0 ? (
          <p className="hint">{error ? "记忆打不开" : configured ? (items.length === 0 ? "还没有记忆" : "没有匹配的记忆") : "记忆还没接上"}</p>
        ) : (
          <ul className="expert-grid">
            {filtered.map((item) => (
              <li key={item.id} className="dash-card">
                <div>
                  <strong>{item.text.slice(0, 72)}</strong>
                  {item.text.length > 72 ? <p>{item.text}</p> : null}
                </div>
                <div className="card-actions">
                  <IslandButton type="default" danger disabled={busy} onClick={() => remove(item.id)}>
                    删除
                  </IslandButton>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="error">{error}</p> : null}
      </div>
      {createOpen ? (
        <Modal title="记一条" onClose={() => setCreateOpen(false)}>
          <form
            className="modal-form"
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
            <div className="modal-actions">
              <IslandButton type="primary" htmlType="submit" disabled={busy || !draft.trim()}>
                {busy ? "保存中…" : "保存"}
              </IslandButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
}

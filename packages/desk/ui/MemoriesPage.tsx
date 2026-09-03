import {
  MEMORY_LIST_LIMIT_DEFAULT,
  MEMORY_SEARCH_DEBOUNCE_MS,
  MEMORY_SNIPPET_LENGTH,
  MEMORY_TEXT_MAX_LENGTH,
  memoryEdited,
  memoryHint,
  readMemoryError,
  type MemoryItem,
} from "@neo-cloud-agent/contracts/memory";
import { useEffect, useState } from "react";
import { api, readJson } from "./api";
import { IconPlus } from "./icons";
import { IslandButton, IslandInput } from "./island";
import { Modal, Page } from "./pages";

type Editor = { mode: "new" } | { mode: "edit"; id: string; original: string; updatedAt?: string };

type Props = {
  token: string;
};

function memorySnippet(text: string): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > MEMORY_SNIPPET_LENGTH ? `${value.slice(0, MEMORY_SNIPPET_LENGTH)}…` : value;
}

export function MemoriesPage({ token }: Props) {
  const [configured, setConfigured] = useState(false);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemoryItem[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visibleItems = query.trim() ? (hits ?? []) : items;
  const hint = memoryHint({ configured, count: items.length, error: error || undefined });

  const refresh = async () => {
    const response = await api(token, `/v1/memories?limit=${MEMORY_LIST_LIMIT_DEFAULT}`);
    const body = await readJson<{ configured?: boolean; memories?: MemoryItem[] }>(response);
    const message = readMemoryError(body);
    if (!response.ok || message) throw new Error(message || "加载记忆失败");
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
    const needle = query.trim();
    if (!needle) {
      setHits(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        const response = await api(token, "/v1/memories/search", {
          method: "POST",
          body: JSON.stringify({ query: needle }),
        });
        const body = await readJson<{ memories?: MemoryItem[] }>(response);
        const message = readMemoryError(body);
        if (!response.ok || message) throw new Error(message || "搜索失败");
        setHits((body.memories ?? []).filter((item) => item.id && item.text));
      })().catch((caught) => {
        setError(caught instanceof Error ? caught.message : "搜索失败");
      });
    }, MEMORY_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, token]);

  const closeEditor = () => {
    setEditor(null);
    setDraft("");
  };

  const save = () => {
    const text = draft.trim();
    if (!text || busy || !token || !editor) return;
    if (editor.mode === "edit" && text === editor.original) {
      closeEditor();
      return;
    }
    setBusy(true);
    void (async () => {
      if (editor.mode === "new") {
        const response = await api(token, "/v1/memories", { method: "POST", body: JSON.stringify({ text }) });
        const body = await readJson(response);
        const message = readMemoryError(body);
        if (!response.ok || message) throw new Error(message || "记下失败");
        closeEditor();
        await refresh();
        return;
      }
      const response = await api(token, `/v1/memories/${encodeURIComponent(editor.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ text, updatedAt: editor.updatedAt }),
      });
      const body = await readJson<{ memory?: MemoryItem }>(response);
      const message = readMemoryError(body);
      if (!response.ok || message || !body.memory) throw new Error(message || "改不了");
      const next = body.memory;
      setItems((prev) => prev.map((item) => (item.id === next.id ? next : item)));
      setHits((prev) => (prev ? prev.map((item) => (item.id === next.id ? next : item)) : prev));
      closeEditor();
    })()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : editor.mode === "new" ? "记下失败" : "改不了");
      })
      .finally(() => setBusy(false));
  };

  const remove = (id: string) => {
    if (busy || !token || !window.confirm("删除这条记忆？")) return;
    setBusy(true);
    void (async () => {
      const response = await api(token, `/v1/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await readJson(response);
      const message = readMemoryError(body);
      if (!response.ok || message) throw new Error(message || "删除失败");
      setItems((prev) => prev.filter((item) => item.id !== id));
      setHits((prev) => (prev ? prev.filter((item) => item.id !== id) : prev));
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
              setEditor({ mode: "new" });
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
        {visibleItems.length === 0 ? (
          <p className="hint">{error ? "记忆打不开" : configured ? (items.length === 0 ? "还没有记忆" : "没有匹配的记忆") : "记忆还没接上"}</p>
        ) : (
          <ul className="expert-grid">
            {visibleItems.map((item) => (
              <li key={item.id} className="dash-card">
                <div>
                  <strong>
                    {memorySnippet(item.text)}
                    {memoryEdited(item) ? <em> 改过</em> : null}
                  </strong>
                  {item.text.length > MEMORY_SNIPPET_LENGTH ? <p>{item.text}</p> : null}
                </div>
                <div className="card-actions">
                  <IslandButton
                    type="default"
                    disabled={busy}
                    onClick={() => {
                      setDraft(item.text);
                      setEditor({ mode: "edit", id: item.id, original: item.text, updatedAt: item.updatedAt });
                    }}
                  >
                    编辑
                  </IslandButton>
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
      {editor ? (
        <Modal title={editor.mode === "edit" ? "改这条" : "记一条"} onClose={closeEditor}>
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label>
              <span>内容</span>
              <textarea
                value={draft}
                rows={4}
                maxLength={MEMORY_TEXT_MAX_LENGTH}
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

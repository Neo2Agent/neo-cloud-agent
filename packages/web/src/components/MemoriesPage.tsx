import { useEffect, useState } from "react";
import {
  MEMORY_KIND,
  MEMORY_SEARCH_DEBOUNCE_MS,
  MEMORY_STATUS,
  MEMORY_TEXT_MAX_LENGTH,
  memoryEdited,
  memoryKind,
  memoryKindLabel,
  readMemoryError,
  type MemoryItem,
  type MemoryKind,
  type MemorySettings,
} from "@neo-cloud-agent/contracts/memory";
import { api, readJson } from "../api";
import { clampPage, paginate } from "../catalog.js";
import { IconMemory, IconPlus } from "../icons.js";
import { useConfirm } from "../feedback.js";
import { CatalogCard, CatalogEmpty, CatalogForm, CatalogGrid, CatalogModal, CatalogPager, CatalogToolbar } from "./Catalog.js";

type Editor = { mode: "new" } | { mode: "edit"; id: string; original: string; updatedAt?: string };

type Props = {
  token: string;
};

export function MemoriesPage({ token }: Props) {
  const [configured, setConfigured] = useState(false);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemoryItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<MemorySettings>({ enabled: true, configured: false });
  const [kindFilter, setKindFilter] = useState<MemoryKind | "">("");
  const confirm = useConfirm();
  const needle = query.trim();
  const filtered = (needle ? (hits ?? items) : items).filter((item) => !kindFilter || memoryKind(item) === kindFilter);
  const visibleItems = filtered;
  const listPage = clampPage(page, visibleItems.length);
  const visible = paginate(visibleItems, listPage);

  const refresh = async () => {
    if (!token) return;
    const response = await api(token, "/v1/memories");
    const body = await readJson<{ configured?: boolean; memories?: MemoryItem[] }>(response);
    const message = readMemoryError(body);
    if (!response.ok || message) throw new Error(message || "加载记忆失败");
    setConfigured(Boolean(body.configured));
    setItems((body.memories ?? []).filter((item) => item.id && item.text));
    const settingsResponse = await api(token, "/v1/settings/memory");
    const settingsBody = await readJson<MemorySettings>(settingsResponse);
    if (settingsResponse.ok) {
      setSettings({
        enabled: settingsBody.enabled !== false,
        configured: Boolean(settingsBody.configured ?? body.configured),
      });
    }
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

  useEffect(() => {
    if (!needle) {
      setHits(null);
      setSearching(false);
      return;
    }
    if (!token) return;
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await api(token, "/v1/memories/search", {
            method: "POST",
            body: JSON.stringify({ query: needle }),
          });
          const body = await readJson<{ memories?: MemoryItem[] }>(response);
          const message = readMemoryError(body);
          if (!response.ok || message) throw new Error(message || "搜索失败");
          if (cancelled) return;
          setHits((body.memories ?? []).filter((item) => item.id && item.text));
          setError("");
        } catch (caught) {
          if (cancelled) return;
          setHits([]);
          setError(caught instanceof Error ? caught.message : "搜索失败");
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, MEMORY_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [token, needle]);

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
      const merge = (item: MemoryItem) =>
        item.id === next.id
          ? {
              ...item,
              ...next,
              createdAt: next.createdAt ?? item.createdAt,
              updatedAt: next.updatedAt ?? item.updatedAt,
            }
          : item;
      setItems((prev) => prev.map(merge));
      setHits((prev) => (prev ? prev.map(merge) : prev));
      closeEditor();
    })()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : editor.mode === "new" ? "记下失败" : "改不了");
      })
      .finally(() => setBusy(false));
  };

  const remove = async (id: string) => {
    if (busy || !token) return;
    if (
      !(await confirm({
        title: "删除这条记忆？",
        message: "删掉后跨对话不会再带上它。",
        confirmLabel: "删除",
        danger: true,
      }))
    ) {
      return;
    }
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

  const saveSettings = (patch: { enabled?: boolean }) => {
    if (busy || !token) return;
    setBusy(true);
    void (async () => {
      const response = await api(token, "/v1/settings/memory", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      const body = await readJson<MemorySettings>(response);
      const message = readMemoryError(body);
      if (!response.ok || message) throw new Error(message || "保存设置失败");
      setSettings({
        enabled: body.enabled !== false,
        configured: Boolean(body.configured),
      });
    })()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "保存设置失败");
      })
      .finally(() => setBusy(false));
  };

  const emptyTitle = searching
    ? "正在搜索…"
    : error
      ? "记忆打不开"
      : configured
        ? items.length === 0
          ? "还没有记忆"
          : "没有匹配的记忆"
        : "记忆还没接上";
  const searchStatus = !needle ? "" : searching ? "正在搜索…" : `找到 ${hits?.length ?? 0} 条`;
  const editingId = editor?.mode === "edit" ? editor.id : "";

  const openNew = () => {
    setDraft("");
    setEditor({ mode: "new" });
  };

  return (
    <section className="proj-page catalog-page" id="memories-page">
      <div className="memory-kind-filters">
        {(["", MEMORY_KIND.coding, MEMORY_KIND.style, MEMORY_KIND.habit] as const).map((kind) => (
          <button
            key={kind || "all"}
            type="button"
            className={kindFilter === kind ? "ghost is-active" : "ghost"}
            onClick={() => setKindFilter(kind)}
          >
            {kind ? memoryKindLabel(kind) : "全部"}
          </button>
        ))}
        <button
          type="button"
          className={settings.enabled ? "icon-btn memory-recall is-on" : "icon-btn memory-recall"}
          aria-pressed={settings.enabled}
          aria-label="开聊时召回用户记忆"
          title="开聊时召回用户记忆"
          disabled={busy}
          onClick={() => saveSettings({ enabled: !settings.enabled })}
        >
          <IconMemory size={16} />
        </button>
      </div>

      <CatalogToolbar search={query} onSearch={setQuery} placeholder="搜索记忆" />
      {error ? <p className="setup err">{error}</p> : null}
      {searchStatus ? <p className="memory-search-status">{searchStatus}</p> : null}

      {visibleItems.length === 0 ? (
        <CatalogEmpty title={emptyTitle} />
      ) : (
        <>
          <CatalogGrid className={searching ? "is-searching" : undefined}>
            {visible.map((item) => {
              const openEditor = () => {
                setDraft(item.text);
                setEditor({ mode: "edit", id: item.id, original: item.text, updatedAt: item.updatedAt });
              };
              return (
                <CatalogCard
                  key={item.id}
                  title={item.text}
                  className="memory-card"
                  badge={
                    [
                      memoryKindLabel(memoryKind(item)),
                      item.metadata?.status === MEMORY_STATUS.candidate ? "候选" : "",
                      memoryEdited(item) ? "改过" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  active={item.id === editingId}
                  onOpen={openEditor}
                  actions={
                    <>
                      <button type="button" className="ghost" disabled={busy} onClick={openEditor}>
                        编辑
                      </button>
                      <button type="button" className="ghost danger" disabled={busy} onClick={() => void remove(item.id)}>
                        删除
                      </button>
                    </>
                  }
                />
              );
            })}
          </CatalogGrid>
          <CatalogPager page={listPage} total={visibleItems.length} onPage={setPage} />
        </>
      )}

      <CatalogModal
        title={editor?.mode === "edit" ? "改这条" : "记一条"}
        open={Boolean(editor)}
        onClose={closeEditor}
        footer={
          <>
            <button type="button" className="ghost" onClick={closeEditor}>
              取消
            </button>
            <button
              type="button"
              className="proj-add"
              disabled={busy || !draft.trim() || (editor?.mode === "edit" && draft.trim() === editor.original)}
              onClick={save}
            >
              保存
            </button>
          </>
        }
      >
        <CatalogForm
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
          <p className="memory-editor-count">
            {draft.length}/{MEMORY_TEXT_MAX_LENGTH}
          </p>
        </CatalogForm>
      </CatalogModal>
      <button type="button" className="memory-fab" aria-label="记一条" title="记一条" onClick={openNew}>
        <IconPlus size={20} />
      </button>
    </section>
  );
}

import { useEffect, useState } from "react";
import {
  MEMORY_KIND,
  MEMORY_SEARCH_DEBOUNCE_MS,
  MEMORY_TEXT_MAX_LENGTH,
  USER_RULES_MAX_LENGTH,
  isPinnedMemory,
  memoryEdited,
  memoryHint,
  memoryKind,
  memoryKindLabel,
  readMemoryError,
  type MemoryItem,
  type MemoryKind,
  type MemorySettings,
} from "@neo-cloud-agent/contracts/memory";
import { api, readJson } from "../api";
import { clampPage, paginate } from "../catalog.js";
import { IconBack } from "../icons.js";
import { useConfirm } from "../feedback.js";
import { CatalogCard, CatalogEmpty, CatalogForm, CatalogGrid, CatalogModal, CatalogPager, CatalogToolbar } from "./Catalog.js";

type Editor = { mode: "new" } | { mode: "edit"; id: string; original: string; updatedAt?: string };

type Props = {
  token: string;
  onBack?: () => void;
};

export function MemoriesPage({ token, onBack }: Props) {
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
  const [settings, setSettings] = useState<MemorySettings>({ enabled: true, userRules: "", configured: false });
  const [rulesDraft, setRulesDraft] = useState("");
  const [kindFilter, setKindFilter] = useState<MemoryKind | "">("");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
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
        userRules: settingsBody.userRules ?? "",
        configured: Boolean(settingsBody.configured ?? body.configured),
      });
      setRulesDraft(settingsBody.userRules ?? "");
    }
    const projectsResponse = await api(token, "/v1/projects");
    const projectsBody = await readJson<{ projects?: Array<{ id?: string; name?: string }> }>(projectsResponse);
    if (projectsResponse.ok) {
      setProjects(
        (projectsBody.projects ?? [])
          .filter((item): item is { id: string; name: string } => Boolean(item.id && item.name))
          .map((item) => ({ id: item.id, name: item.name })),
      );
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

  const saveSettings = (patch: { enabled?: boolean; userRules?: string }) => {
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
        userRules: body.userRules ?? "",
        configured: Boolean(body.configured),
      });
      if (patch.userRules !== undefined) {
        setRulesDraft(body.userRules ?? "");
      }
    })()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "保存设置失败");
      })
      .finally(() => setBusy(false));
  };

  const pin = (id: string, pinned: boolean) => {
    if (busy || !token) return;
    setBusy(true);
    void (async () => {
      const response = await api(token, `/v1/memories/${encodeURIComponent(id)}/pin`, {
        method: "POST",
        body: JSON.stringify({ pinned }),
      });
      const body = await readJson<{ memory?: MemoryItem }>(response);
      const message = readMemoryError(body);
      if (!response.ok || message || !body.memory) throw new Error(message || "钉住失败");
      await refresh();
    })()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "钉住失败");
      })
      .finally(() => setBusy(false));
  };

  const promote = (id: string, target: "user" | "project", projectId?: string) => {
    if (busy || !token) return;
    setBusy(true);
    void (async () => {
      const response = await api(token, `/v1/memories/${encodeURIComponent(id)}/promote`, {
        method: "POST",
        body: JSON.stringify({ target, mode: "move", projectId }),
      });
      const body = await readJson(response);
      const message = readMemoryError(body);
      if (!response.ok || message) throw new Error(message || "提升失败");
      await refresh();
    })()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "提升失败");
      })
      .finally(() => setBusy(false));
  };

  const hint = memoryHint({ configured, count: items.length, error: error || undefined });
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

      <section className="memory-settings">
        <label className="memory-enabled">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            onChange={(event) => saveSettings({ enabled: event.target.checked })}
          />
          开聊时召回用户记忆
        </label>
        <label>
          <span>用户规则</span>
          <textarea
            value={rulesDraft}
            rows={4}
            maxLength={USER_RULES_MAX_LENGTH}
            placeholder="人手写的硬规则。仍弱于当前消息和项目指令。"
            onChange={(event) => setRulesDraft(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="ghost"
          disabled={busy || rulesDraft === settings.userRules}
          onClick={() => saveSettings({ userRules: rulesDraft })}
        >
          保存规则
        </button>
      </section>

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
      </div>

      <CatalogToolbar
        search={query}
        onSearch={setQuery}
        placeholder="搜索记忆"
        actionLabel={configured ? "记一条" : undefined}
        onAction={
          configured
            ? () => {
                setDraft("");
                setEditor({ mode: "new" });
              }
            : undefined
        }
      />
      {searchStatus ? <p className="memory-search-status">{searchStatus}</p> : null}

      {visibleItems.length === 0 ? (
        <CatalogEmpty
          title={emptyTitle}
          hint={
            searching
              ? "正在按你输入的内容检索。"
              : items.length === 0 && configured && !error
                ? "对话里说「帮我记住」，或点右上角记一条。"
                : needle
                  ? "换个词试试，或清空搜索看全部。"
                  : hint
          }
          action={
            configured && items.length === 0 && !error && !needle ? (
              <button
                className="proj-add"
                type="button"
                onClick={() => {
                  setDraft("");
                  setEditor({ mode: "new" });
                }}
              >
                记一条
              </button>
            ) : null
          }
        />
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
                  badge={
                    [
                      memoryKindLabel(memoryKind(item)),
                      isPinnedMemory(item) ? "钉住" : "",
                      item.metadata?.status === "candidate" ? "候选" : "",
                      memoryEdited(item) ? "改过" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  initial="记"
                  active={item.id === editingId}
                  onOpen={openEditor}
                  actions={
                    <>
                      <button type="button" className="ghost" disabled={busy} onClick={openEditor}>
                        编辑
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => pin(item.id, !isPinnedMemory(item))}
                      >
                        {isPinnedMemory(item) ? "取消钉住" : "钉住"}
                      </button>
                      <button type="button" className="ghost" disabled={busy} onClick={() => promote(item.id, "user")}>
                        提升为规则
                      </button>
                      {projects[0] ? (
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy}
                          onClick={() => promote(item.id, "project", projects[0]?.id)}
                        >
                          挪到项目
                        </button>
                      ) : null}
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
    </section>
  );
}

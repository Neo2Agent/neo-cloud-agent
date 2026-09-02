import { useEffect, useMemo, useState } from "react";
import { pluginPickerLabel, type PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import { api, readJson } from "../api";
import { clampPage, filterByQuery, paginate, snippet } from "../catalog.js";
import { IconBack } from "../icons.js";
import { CatalogCard, CatalogEmpty, CatalogGrid, CatalogPager, CatalogTabs, CatalogToolbar } from "./Catalog.js";

type Props = {
  token: string;
  selectedId?: string | null;
  projectId?: string | null;
  onOpenPlugin: (id: string | null) => void;
  onUse: (plugin: PluginCatalogItem) => void;
};

type SkillTab = "installed" | "catalog";

export function SkillsPage({ token, selectedId, projectId, onOpenPlugin, onUse }: Props) {
  const [plugins, setPlugins] = useState<PluginCatalogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<SkillTab>("installed");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const selected = plugins.find((item) => item.id === selectedId || item.slug === selectedId) ?? null;
  const installed = useMemo(() => plugins.filter((item) => item.installed), [plugins]);
  const catalog = useMemo(() => plugins.filter((item) => !item.installed), [plugins]);
  const pool = tab === "installed" ? installed : catalog;
  const filtered = useMemo(
    () => filterByQuery(pool, query, (item) => [item.name, item.slug, item.description, item.category]),
    [pool, query],
  );
  const listPage = clampPage(page, filtered.length);
  const visible = paginate(filtered, listPage);

  const refresh = async () => {
    const queryStr = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const res = await api(token, `/v1/plugins${queryStr}`);
    if (res.ok) {
      setPlugins((await readJson<{ plugins?: PluginCatalogItem[] }>(res)).plugins ?? []);
    }
  };

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [token, projectId]);

  useEffect(() => {
    setPage(1);
  }, [query, tab]);

  const act = async (path: string, body: Record<string, unknown>, method = "POST") => {
    setBusy(true);
    setError("");
    try {
      const res = await api(token, path, { method, body: JSON.stringify(body) });
      if (!res.ok) {
        throw new Error((await readJson<{ error?: string }>(res)).error || "操作失败");
      }
      await refresh();
    } catch (item) {
      setError(item instanceof Error ? item.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <section className="proj-page catalog-page" id="skills-page">
        <header className="proj-page-head">
          <div>
            <button className="catalog-back" type="button" onClick={() => onOpenPlugin(null)}>
              <IconBack />
              全部技能
            </button>
            <h2>{pluginPickerLabel(selected)}</h2>
            <p className="hint">{selected.description}</p>
          </div>
        </header>
        <div className="proj-card">
          <p className="hint">
            {selected.enabled ? "已启用，下次开对话会写进工作区。" : "已关闭或未安装。安装并启用后才会进下一次 Run。"}
          </p>
          <div className="expert-actions">
            {selected.installed ? (
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => void act(`/v1/plugins/${selected.id}/enable`, { enabled: !selected.enabled, scope: selected.installScope ?? "user" })}
              >
                {selected.enabled ? "关闭" : "启用"}
              </button>
            ) : (
              <button type="button" className="proj-add" disabled={busy} onClick={() => void act(`/v1/plugins/${selected.id}/install`, { scope: "user" })}>
                安装
              </button>
            )}
            <button type="button" className="ghost" onClick={() => onUse(selected)}>
              用这个开对话
            </button>
            {selected.installed && selected.installScope ? (
              <button
                type="button"
                className="ghost danger"
                disabled={busy}
                onClick={() => void act(`/v1/plugins/${selected.id}/install`, { scope: selected.installScope }, "DELETE")}
              >
                卸载
              </button>
            ) : null}
          </div>
        </div>
        {error ? <p className="auth-error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="proj-page catalog-page" id="skills-page">
      <header className="proj-page-head">
        <div>
          <p className="eyebrow">技能</p>
          <h2>给 Agent 装工作手册</h2>
          <p className="hint">安装并启用后，下一次对话会把 SKILL.md 写进工作区。主操作是安装 / 启停，不是召唤角色。</p>
        </div>
      </header>

      <CatalogTabs
        tabs={[
          { id: "installed", label: "已安装", count: installed.length },
          { id: "catalog", label: "官方目录", count: catalog.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <CatalogToolbar search={query} onSearch={setQuery} placeholder="搜索技能" />

      {filtered.length === 0 ? (
        <CatalogEmpty
          title={pool.length === 0 ? (tab === "installed" ? "还没有安装技能" : "目录是空的") : "没有匹配的技能"}
          hint={pool.length === 0 ? (tab === "installed" ? "到官方目录里挑一个装上。" : "控制面还没放出技能包。") : "换个关键词再试试。"}
          action={
            tab === "installed" && pool.length === 0 ? (
              <button type="button" className="proj-add" onClick={() => setTab("catalog")}>
                去官方目录
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
                title={pluginPickerLabel(item)}
                description={snippet(item.description, 90)}
                badge={item.pinned ? "项目" : item.enabled ? "已启用" : item.installed ? "已关闭" : "官方"}
                meta={item.category}
                onOpen={() => onOpenPlugin(item.id)}
                actions={
                  <>
                    {!item.installed ? (
                      <button type="button" className="quiet-btn primary" disabled={busy} onClick={() => void act(`/v1/plugins/${item.id}/install`, { scope: "user" })}>
                        安装
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => void act(`/v1/plugins/${item.id}/enable`, { enabled: !item.enabled, scope: item.installScope ?? "user" })}
                      >
                        {item.enabled ? "关闭" : "启用"}
                      </button>
                    )}
                    <button type="button" className="ghost" onClick={() => onUse(item)}>
                      用这个
                    </button>
                  </>
                }
              />
            ))}
          </CatalogGrid>
          <CatalogPager page={listPage} total={filtered.length} onPage={setPage} />
        </>
      )}
      {error ? <p className="auth-error">{error}</p> : null}
    </section>
  );
}

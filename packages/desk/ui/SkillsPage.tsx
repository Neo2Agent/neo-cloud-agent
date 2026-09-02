import { pluginPickerLabel, type PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import { useEffect, useMemo, useState } from "react";
import { api, readJson } from "./api";
import { IslandButton, IslandInput } from "./island";
import { Page } from "./pages";

type Props = {
  token: string;
  selectedId?: string | null;
  projectId?: string | null;
  onOpenPlugin: (id: string | null) => void;
  onUse: (plugin: PluginCatalogItem) => void;
  onChanged?: () => void;
};

type SkillTab = "installed" | "catalog";

export function SkillsPage({ token, selectedId, projectId, onOpenPlugin, onUse, onChanged }: Props) {
  const [plugins, setPlugins] = useState<PluginCatalogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<SkillTab>("installed");
  const [query, setQuery] = useState("");
  const selected = plugins.find((item) => item.id === selectedId || item.slug === selectedId) ?? null;
  const installed = useMemo(() => plugins.filter((item) => item.installed), [plugins]);
  const catalog = useMemo(() => plugins.filter((item) => !item.installed), [plugins]);
  const pool = tab === "installed" ? installed : catalog;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return pool;
    return pool.filter((item) =>
      [item.name, item.slug, item.description, item.category].some((value) => value?.toLowerCase().includes(needle)),
    );
  }, [pool, query]);

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

  const act = async (path: string, body: Record<string, unknown>, method = "POST") => {
    setBusy(true);
    setError("");
    try {
      const res = await api(token, path, { method, body: JSON.stringify(body) });
      if (!res.ok) {
        throw new Error((await readJson<{ error?: string }>(res)).error || "操作失败");
      }
      await refresh();
      onChanged?.();
    } catch (item) {
      setError(item instanceof Error ? item.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <Page>
        <header className="dash-head">
          <div>
            <button type="button" className="crumb-link" onClick={() => onOpenPlugin(null)}>
              全部技能
            </button>
            <h1>{pluginPickerLabel(selected)}</h1>
            <p>{selected.description}</p>
          </div>
        </header>
        <div className="page-body">
          <p className="hint">
            {selected.enabled ? "已启用，下次开对话会写进工作区。" : "已关闭或未安装。安装并启用后才会进下一次 Run。"}
          </p>
          <div className="card-actions">
            {selected.installed ? (
              <IslandButton
                type="default"
                disabled={busy}
                onClick={() =>
                  void act(`/v1/plugins/${selected.id}/enable`, {
                    enabled: !selected.enabled,
                    scope: selected.installScope ?? "user",
                  })
                }
              >
                {selected.enabled ? "关闭" : "启用"}
              </IslandButton>
            ) : (
              <IslandButton type="primary" disabled={busy} onClick={() => void act(`/v1/plugins/${selected.id}/install`, { scope: "user" })}>
                安装
              </IslandButton>
            )}
            <IslandButton type="text" onClick={() => onUse(selected)}>
              用这个开对话
            </IslandButton>
            {selected.installed && selected.installScope ? (
              <IslandButton
                type="default"
                disabled={busy}
                onClick={() => void act(`/v1/plugins/${selected.id}/install`, { scope: selected.installScope }, "DELETE")}
              >
                卸载
              </IslandButton>
            ) : null}
          </div>
          {error ? <p className="error">{error}</p> : null}
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <header className="dash-head">
        <div>
          <h1>技能</h1>
          <p>安装并启用后，下一次对话会把 SKILL.md 写进工作区。主操作是安装 / 启停，不是召唤角色。</p>
        </div>
      </header>
      <div className="page-body">
        <div className="workbench-tabs" aria-label="技能分组">
          <button type="button" className={tab === "installed" ? "on" : ""} onClick={() => setTab("installed")}>
            已安装 {installed.length}
          </button>
          <button type="button" className={tab === "catalog" ? "on" : ""} onClick={() => setTab("catalog")}>
            官方目录 {catalog.length}
          </button>
        </div>
        <IslandInput value={query} placeholder="搜索技能" onChange={(event) => setQuery(event.target.value)} aria-label="搜索技能" />
        {filtered.length === 0 ? (
          <p className="hint">{tab === "installed" ? "还没有安装技能。" : "没有匹配的技能。"}</p>
        ) : (
          <ul className="expert-grid">
            {filtered.map((item) => (
              <li key={item.id} className="dash-card">
                <div>
                  <strong>{pluginPickerLabel(item)}</strong>
                  <p>{item.description}</p>
                </div>
                <div className="card-actions">
                  <IslandButton type="text" onClick={() => onOpenPlugin(item.id)}>
                    打开
                  </IslandButton>
                  <IslandButton type="default" onClick={() => onUse(item)}>
                    用这个开对话
                  </IslandButton>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="error">{error}</p> : null}
      </div>
    </Page>
  );
}

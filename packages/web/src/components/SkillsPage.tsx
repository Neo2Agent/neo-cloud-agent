import { useEffect, useMemo, useState } from "react";
import { pluginPickerLabel, type PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import { api, readJson } from "../api";

type Props = {
  token: string;
  selectedId?: string | null;
  projectId?: string | null;
  onOpenPlugin: (id: string | null) => void;
  onUse: (plugin: PluginCatalogItem) => void;
};

export function SkillsPage({ token, selectedId, projectId, onOpenPlugin, onUse }: Props) {
  const [plugins, setPlugins] = useState<PluginCatalogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = plugins.find((item) => item.id === selectedId || item.slug === selectedId) ?? null;
  const installed = useMemo(() => plugins.filter((item) => item.installed), [plugins]);
  const catalog = useMemo(() => plugins.filter((item) => !item.installed), [plugins]);

  const refresh = async () => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const res = await api(token, `/v1/plugins${query}`);
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
    } catch (item) {
      setError(item instanceof Error ? item.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <section className="proj-page" id="skills-page">
        <header className="proj-page-head">
          <div>
            <p className="eyebrow">技能</p>
            <h2>{pluginPickerLabel(selected)}</h2>
            <p className="hint">{selected.description}</p>
          </div>
          <button type="button" className="ghost" onClick={() => onOpenPlugin(null)}>
            返回列表
          </button>
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
                className="ghost"
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
    <section className="proj-page" id="skills-page">
      <header className="proj-page-head">
        <div>
          <p className="eyebrow">技能</p>
          <h2>给 Agent 装工作手册</h2>
          <p className="hint">安装并启用后，下一次对话会把 SKILL.md 写进工作区。主操作是安装 / 启停，不是召唤角色。</p>
        </div>
        <p className="proj-count">{plugins.length} 个</p>
      </header>
      <PluginGroup title="已安装" items={installed} busy={busy} onOpen={onOpenPlugin} onUse={onUse} onEnable={(item, enabled) => void act(`/v1/plugins/${item.id}/enable`, { enabled, scope: item.installScope ?? "user" })} />
      <PluginGroup
        title="官方目录"
        items={catalog}
        busy={busy}
        onOpen={onOpenPlugin}
        onUse={onUse}
        onInstall={(item) => void act(`/v1/plugins/${item.id}/install`, { scope: "user" })}
      />
      {error ? <p className="auth-error">{error}</p> : null}
    </section>
  );
}

function PluginGroup({
  title,
  items,
  busy,
  onOpen,
  onUse,
  onInstall,
  onEnable,
}: {
  title: string;
  items: PluginCatalogItem[];
  busy: boolean;
  onOpen: (id: string) => void;
  onUse: (item: PluginCatalogItem) => void;
  onInstall?: (item: PluginCatalogItem) => void;
  onEnable?: (item: PluginCatalogItem, enabled: boolean) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="proj-card">
      <p className="proj-card-title">{title}</p>
      <ul className="expert-grid">
        {items.map((item) => (
          <li key={item.id}>
            <article className="expert-card">
              <button type="button" className="expert-card-main" onClick={() => onOpen(item.id)}>
                <strong>{pluginPickerLabel(item)}</strong>
                <span className="expert-badge">{item.pinned ? "项目" : item.enabled ? "已启用" : item.installed ? "已关闭" : "官方"}</span>
                <p>{item.description}</p>
              </button>
              {onInstall && !item.installed ? (
                <button type="button" className="ghost" disabled={busy} onClick={() => onInstall(item)}>
                  安装
                </button>
              ) : null}
              {onEnable && item.installed ? (
                <button type="button" className="ghost" disabled={busy} onClick={() => onEnable(item, !item.enabled)}>
                  {item.enabled ? "关闭" : "启用"}
                </button>
              ) : null}
              <button type="button" className="ghost" onClick={() => onUse(item)}>
                用这个开对话
              </button>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { pluginPickerLabel, type PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import { useEffect, useMemo, useState } from "react";
import { api, readJson } from "./api";
import { deskBridge } from "./desk";
import { IslandButton, IslandInput } from "./island";
import { Page } from "./pages";
import { listedSkillKey, parseListedSkillKey, SKILL_ORIGIN_WORKSPACE, type ListedSkill, type ListedSkills } from "../src/skill-list";

const SKILL_TAB_SYSTEM = "system" as const;
const SKILL_TAB_WORKSPACE = "workspace" as const;
const SKILL_TAB_CATALOG = "catalog" as const;

type SkillTab = typeof SKILL_TAB_SYSTEM | typeof SKILL_TAB_WORKSPACE | typeof SKILL_TAB_CATALOG;

type Props = {
  token: string;
  selectedId?: string | null;
  projectId?: string | null;
  folder?: string;
  onOpenPlugin: (id: string | null) => void;
  onUsePlugin: (plugin: PluginCatalogItem) => void;
  onUseLocal: (skill: ListedSkill) => void;
  onChanged?: () => void;
};

const EMPTY_LOCAL: ListedSkills = { system: [], workspace: [], skipped: [] };

function matchesQuery(item: { name: string; slug: string; description: string; category?: string }, needle: string): boolean {
  return [item.name, item.slug, item.description, item.category].some((value) => value?.toLowerCase().includes(needle));
}

export function SkillsPage({
  token,
  selectedId,
  projectId,
  folder,
  onOpenPlugin,
  onUsePlugin,
  onUseLocal,
  onChanged,
}: Props) {
  const [plugins, setPlugins] = useState<PluginCatalogItem[]>([]);
  const [local, setLocal] = useState<ListedSkills>(EMPTY_LOCAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<SkillTab>(SKILL_TAB_SYSTEM);
  const [query, setQuery] = useState("");
  const selectedPlugin = plugins.find((item) => item.id === selectedId || item.slug === selectedId) ?? null;
  const selectedKey = selectedId ? parseListedSkillKey(selectedId) : null;
  const selectedLocal =
    selectedKey == null
      ? null
      : (selectedKey.origin === SKILL_ORIGIN_WORKSPACE ? local.workspace : local.system).find(
          (item) => item.slug === selectedKey.slug,
        ) ?? null;
  const catalog = useMemo(
    () => [...plugins].sort((left, right) => Number(right.installed) - Number(left.installed)),
    [plugins],
  );
  const needle = query.trim().toLowerCase();
  const filteredLocal = useMemo(() => {
    const pool = tab === SKILL_TAB_WORKSPACE ? local.workspace : local.system;
    if (!needle) return pool;
    return pool.filter((item) => matchesQuery(item, needle));
  }, [local.system, local.workspace, needle, tab]);
  const filteredCatalog = useMemo(() => {
    if (!needle) return catalog;
    return catalog.filter((item) => matchesQuery(item, needle));
  }, [catalog, needle]);

  const refreshCatalog = async () => {
    const queryStr = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const res = await api(token, `/v1/plugins${queryStr}`);
    if (res.ok) {
      setPlugins((await readJson<{ plugins?: PluginCatalogItem[] }>(res)).plugins ?? []);
    }
  };

  const refreshLocal = async () => {
    const listSkills = deskBridge()?.listSkills;
    if (!listSkills) {
      setLocal(EMPTY_LOCAL);
      return;
    }
    const result = await listSkills(folder ? { folder } : {});
    setLocal(result);
    if (result.error) {
      setError(result.error);
    }
  };

  useEffect(() => {
    void refreshCatalog().catch(() => undefined);
  }, [token, projectId]);

  useEffect(() => {
    void refreshLocal().catch(() => undefined);
  }, [folder]);

  const act = async (path: string, body: Record<string, unknown>, method = "POST") => {
    setBusy(true);
    setError("");
    try {
      const res = await api(token, path, { method, body: JSON.stringify(body) });
      if (!res.ok) {
        throw new Error((await readJson<{ error?: string }>(res)).error || "操作失败");
      }
      await refreshCatalog();
      onChanged?.();
    } catch (item) {
      setError(item instanceof Error ? item.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  if (selectedLocal) {
    return (
      <Page>
        <header className="dash-head">
          <div>
            <button type="button" className="crumb-link" onClick={() => onOpenPlugin(null)}>
              全部技能
            </button>
            <h1>{selectedLocal.name}</h1>
            <p>{selectedLocal.description}</p>
          </div>
        </header>
        <div className="page-body">
          <p className="hint">
            {selectedLocal.origin === SKILL_ORIGIN_WORKSPACE
              ? selectedLocal.overridesSystem
                ? "本仓库手册，与系统同名时优先用这一份。"
                : "已经在选中文件夹里，开对话即可，不用再安装。"
              : "安装包同步到本机的系统手册。This Computer 会直接加载。"}
          </p>
          <p className="hint">{selectedLocal.relativePath}</p>
          <div className="card-actions">
            <IslandButton type="text" onClick={() => onUseLocal(selectedLocal)}>
              用这个开对话
            </IslandButton>
          </div>
        </div>
      </Page>
    );
  }

  if (selectedPlugin) {
    return (
      <Page>
        <header className="dash-head">
          <div>
            <button type="button" className="crumb-link" onClick={() => onOpenPlugin(null)}>
              全部技能
            </button>
            <h1>{pluginPickerLabel(selectedPlugin)}</h1>
            <p>{selectedPlugin.description}</p>
          </div>
        </header>
        <div className="page-body">
          <p className="hint">
            {selectedPlugin.enabled ? "已启用，下次开对话会写进工作区。" : "已关闭或未安装。安装并启用后才会进下一次 Run。"}
          </p>
          <div className="card-actions">
            {selectedPlugin.installed ? (
              <IslandButton
                type="default"
                disabled={busy}
                onClick={() =>
                  void act(`/v1/plugins/${selectedPlugin.id}/enable`, {
                    enabled: !selectedPlugin.enabled,
                    scope: selectedPlugin.installScope ?? "user",
                  })
                }
              >
                {selectedPlugin.enabled ? "关闭" : "启用"}
              </IslandButton>
            ) : (
              <IslandButton
                type="primary"
                disabled={busy}
                onClick={() => void act(`/v1/plugins/${selectedPlugin.id}/install`, { scope: "user" })}
              >
                安装
              </IslandButton>
            )}
            <IslandButton type="text" onClick={() => onUsePlugin(selectedPlugin)}>
              用这个开对话
            </IslandButton>
            {selectedPlugin.installed && selectedPlugin.installScope ? (
              <IslandButton
                type="default"
                disabled={busy}
                onClick={() => void act(`/v1/plugins/${selectedPlugin.id}/install`, { scope: selectedPlugin.installScope }, "DELETE")}
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

  const emptyHint =
    tab === SKILL_TAB_WORKSPACE && !folder
      ? "先选本地文件夹。"
      : tab === SKILL_TAB_WORKSPACE
        ? "这个文件夹里还没有技能手册。"
        : tab === SKILL_TAB_SYSTEM
          ? deskBridge()?.listSkills
            ? "还没有系统技能。"
            : "Desk 主进程还是旧版本，退出再打开后才能列出本机技能。"
          : "没有匹配的技能。";

  return (
    <Page>
      <header className="dash-head">
        <div>
          <h1>技能</h1>
          <p>系统来自安装包，本仓库是选中文件夹里的手册，官方目录仍是云端账本的安装与启停。</p>
        </div>
      </header>
      <div className="page-body">
        <div className="workbench-tabs" aria-label="技能分组">
          <button type="button" className={tab === SKILL_TAB_SYSTEM ? "on" : ""} onClick={() => setTab(SKILL_TAB_SYSTEM)}>
            系统 {local.system.length}
          </button>
          <button
            type="button"
            className={tab === SKILL_TAB_WORKSPACE ? "on" : ""}
            onClick={() => setTab(SKILL_TAB_WORKSPACE)}
          >
            本仓库 {local.workspace.length}
          </button>
          <button type="button" className={tab === SKILL_TAB_CATALOG ? "on" : ""} onClick={() => setTab(SKILL_TAB_CATALOG)}>
            官方目录 {catalog.length}
          </button>
        </div>
        <IslandInput value={query} placeholder="搜索技能" onChange={(event) => setQuery(event.target.value)} aria-label="搜索技能" />
        {tab === SKILL_TAB_CATALOG ? (
          filteredCatalog.length === 0 ? (
            <p className="hint">{emptyHint}</p>
          ) : (
            <ul className="expert-grid">
              {filteredCatalog.map((item) => (
                <li key={item.id} className="dash-card">
                  <div>
                    <strong>{pluginPickerLabel(item)}</strong>
                    <p>{item.description}</p>
                    <p className="hint">{item.installed ? (item.enabled ? "已安装 · 已启用" : "已安装 · 已关闭") : "未安装"}</p>
                  </div>
                  <div className="card-actions">
                    <IslandButton type="text" onClick={() => onOpenPlugin(item.id)}>
                      打开
                    </IslandButton>
                    <IslandButton type="default" onClick={() => onUsePlugin(item)}>
                      用这个开对话
                    </IslandButton>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : filteredLocal.length === 0 ? (
          <p className="hint">{emptyHint}</p>
        ) : (
          <ul className="expert-grid">
            {filteredLocal.map((item) => (
              <li key={listedSkillKey(item)} className="dash-card">
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.description}</p>
                  {item.overridesSystem ? <p className="hint">本仓库优先于系统同名技能</p> : null}
                </div>
                <div className="card-actions">
                  <IslandButton type="text" onClick={() => onOpenPlugin(listedSkillKey(item))}>
                    打开
                  </IslandButton>
                  <IslandButton type="default" onClick={() => onUseLocal(item)}>
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

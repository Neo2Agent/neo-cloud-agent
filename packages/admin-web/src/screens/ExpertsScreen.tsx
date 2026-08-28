import { ADMIN_EXPERT_TOOL_CHOICES } from "@neo-cloud-agent/contracts/expert";
import { Checkbox, RadioGroup, Switch } from "@neo-cloud-agent/ui";
import { useEffect, useMemo, useState } from "react";
import { api, readJson } from "../api";
import { clampPage, filterByQuery, paginate, snippet } from "../catalog";
import { CatalogCard, CatalogEmpty, CatalogForm, CatalogGrid, CatalogPager, CatalogToolbar } from "../components/Catalog";
import { IconBack } from "../icons";
import type { AdminBundledExpert, AdminExpertsCatalog } from "../types";

type Draft = {
  enabled: boolean;
  name: string;
  title: string;
  description: string;
  industry: string;
  persona: string;
  methodology: string;
  deliverables: string;
  tools: string[];
  model: string;
  examplePrompts: string;
};

type Props = {
  token: string;
  catalog: AdminExpertsCatalog | null;
  onChanged: () => Promise<void>;
};

function draftFrom(item: AdminBundledExpert): Draft {
  return {
    enabled: item.enabled,
    name: item.live.name,
    title: item.live.title ?? "",
    description: item.live.description,
    industry: item.live.industry ?? "",
    persona: item.live.persona,
    methodology: item.live.methodology,
    deliverables: item.live.deliverables,
    tools: item.live.tools ?? [],
    model: item.live.model ?? "",
    examplePrompts: (item.live.examplePrompts ?? []).join("\n"),
  };
}

function audienceLabel(item: AdminBundledExpert): string {
  if (!item.enabled) return "已停用";
  if (item.audience === "allowlist") return `已下发 ${item.userIds.length} 人`;
  return "全部用户";
}

export function ExpertsScreen({ token, catalog, onChanged }: Props) {
  const experts = catalog?.experts ?? [];
  const users = catalog?.users ?? [];
  const [selectedId, setSelectedId] = useState("");
  const selected = useMemo(() => experts.find((item) => item.id === selectedId) ?? null, [experts, selectedId]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [audience, setAudience] = useState<"all" | "allowlist">("all");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft(draftFrom(selected));
    setAudience(selected.audience);
    setUserIds(selected.userIds);
    setMessage("");
    setError("");
  }, [selected?.id, selected?.updatedAt, selected?.publishedAt]);

  const filtered = useMemo(
    () =>
      filterByQuery(experts, query, (item) => [
        item.live.name,
        item.live.title,
        item.live.description,
        item.live.industry,
        item.slug,
        audienceLabel(item),
      ]),
    [experts, query],
  );
  const listPage = clampPage(page, filtered.length);
  const visible = paginate(filtered, listPage);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const visibleUsers = useMemo(() => {
    const needle = userQuery.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => user.email.toLowerCase().includes(needle) || user.id.toLowerCase().includes(needle));
  }, [userQuery, users]);

  const patch = (partial: Partial<Draft>) => {
    setDraft((cur) => (cur ? { ...cur, ...partial } : cur));
  };

  const run = async (kind: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setError("");
    setMessage("");
    try {
      await work();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy("");
    }
  };

  const saveConfig = () => {
    if (!selected || !draft) return;
    void run("save", async () => {
      const response = await api(token, `/v1/admin/experts/${selected.id}`, {
        method: "POST",
        body: JSON.stringify({
          enabled: draft.enabled,
          name: draft.name,
          title: draft.title.trim() ? draft.title : null,
          description: draft.description,
          industry: draft.industry.trim() ? draft.industry : null,
          persona: draft.persona,
          methodology: draft.methodology,
          deliverables: draft.deliverables,
          tools: draft.tools,
          model: draft.model.trim() ? draft.model : null,
          examplePrompts: draft.examplePrompts
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      });
      const body = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "保存失败");
      setMessage("配置已保存，用户下次打开专家列表即生效。");
    });
  };

  const publish = () => {
    if (!selected) return;
    void run("publish", async () => {
      const response = await api(token, `/v1/admin/experts/${selected.id}/publish`, {
        method: "POST",
        body: JSON.stringify({ audience, userIds: audience === "allowlist" ? userIds : [] }),
      });
      const body = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "下发失败");
      setMessage(audience === "all" ? "已下发给全部用户。" : `已下发给 ${userIds.length} 位用户。`);
    });
  };

  const reset = () => {
    if (!selected) return;
    void run("reset", async () => {
      const response = await api(token, `/v1/admin/experts/${selected.id}/reset`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const body = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "恢复失败");
      setMessage("已恢复代码里的默认文案，下发范围没变。");
    });
  };

  if (!catalog) {
    return (
      <section className="page catalog-page">
        <CatalogEmpty title="正在读取内置专家…" hint="先改配置，再下发给用户。" />
      </section>
    );
  }

  if (selected && draft) {
    return (
      <section className="page catalog-page">
        <header className="page-head">
          <div>
            <button type="button" className="catalog-back" onClick={() => setSelectedId("")}>
              <IconBack />
              全部专家
            </button>
            <h2>{selected.live.name}</h2>
            <p className="hint">
              {selected.slug} · 默认名「{selected.baseline.name}」
            </p>
          </div>
          <Switch
            className="toggle"
            checked={draft.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
            label={draft.enabled ? "启用" : "停用"}
          />
        </header>

        <section className="panel">
          <header className="panel-head">
            <div>
              <h3>配置</h3>
              <p className="hint">保存后用户下次打开专家列表即生效。</p>
            </div>
          </header>
          <CatalogForm
            onSubmit={(event) => {
              event.preventDefault();
              saveConfig();
            }}
          >
            <label>
              <span>名称</span>
              <input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
            </label>
            <label>
              <span>标题</span>
              <input value={draft.title} onChange={(event) => patch({ title: event.target.value })} placeholder="可选" />
            </label>
            <label>
              <span>简介</span>
              <input value={draft.description} onChange={(event) => patch({ description: event.target.value })} />
            </label>
            <label>
              <span>领域</span>
              <input value={draft.industry} onChange={(event) => patch({ industry: event.target.value })} placeholder="engineering" />
            </label>
            <label>
              <span>人设</span>
              <textarea value={draft.persona} onChange={(event) => patch({ persona: event.target.value })} rows={5} />
            </label>
            <label>
              <span>方法论</span>
              <textarea value={draft.methodology} onChange={(event) => patch({ methodology: event.target.value })} rows={6} />
            </label>
            <label>
              <span>交付标准</span>
              <textarea value={draft.deliverables} onChange={(event) => patch({ deliverables: event.target.value })} rows={5} />
            </label>
            <fieldset className="field">
              <legend>工具白名单</legend>
              <p className="hint">不勾选等于不限制。团长需要 neo_subagent。</p>
              <div className="tool-picks">
                {ADMIN_EXPERT_TOOL_CHOICES.map((tool) => (
                  <Checkbox
                    key={tool}
                    checked={draft.tools.includes(tool)}
                    label={tool}
                    onCheckedChange={(checked) => {
                      patch({
                        tools: checked ? [...draft.tools, tool] : draft.tools.filter((item) => item !== tool),
                      });
                    }}
                  />
                ))}
              </div>
            </fieldset>
            <label>
              <span>默认模型</span>
              <input value={draft.model} onChange={(event) => patch({ model: event.target.value })} placeholder="留空则用用户当前模型" />
            </label>
            <label>
              <span>示例任务</span>
              <textarea
                value={draft.examplePrompts}
                onChange={(event) => patch({ examplePrompts: event.target.value })}
                rows={3}
                placeholder="一行一条"
              />
            </label>
            <div className="form-actions">
              <button type="submit" className="primary-btn" disabled={Boolean(busy)}>
                {busy === "save" ? "保存中…" : "保存配置"}
              </button>
              <button type="button" className="ghost" disabled={Boolean(busy)} onClick={reset}>
                {busy === "reset" ? "恢复中…" : "恢复默认文案"}
              </button>
            </div>
          </CatalogForm>
        </section>

        <section className="panel">
          <header className="panel-head">
            <div>
              <h3>下发给用户</h3>
              <p className="hint">停用后谁也看不见。指定用户时，未选中的账号看不到这个内置专家。</p>
            </div>
          </header>
          <div className="audience">
            <RadioGroup
              name="audience"
              value={audience}
              onValueChange={(value) => setAudience(value as "all" | "allowlist")}
              options={[
                { value: "all", label: "全部用户" },
                { value: "allowlist", label: "指定用户" },
              ]}
            />
          </div>
          {audience === "allowlist" ? (
            <>
              <label className="catalog-search">
                <span className="sr-only">筛选用户</span>
                <input
                  type="search"
                  placeholder="搜索账号"
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                />
              </label>
              <ul className="user-picks">
                {visibleUsers.map((user) => (
                  <li key={user.id}>
                    <Checkbox
                      checked={userIds.includes(user.id)}
                      label={user.email}
                      onCheckedChange={(checked) => {
                        setUserIds((cur) => (checked ? [...cur, user.id] : cur.filter((id) => id !== user.id)));
                      }}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="hint">所有能登录的用户都会在专家列表里看到它。</p>
          )}
          <div className="form-actions">
            <button type="button" className="primary-btn" disabled={Boolean(busy)} onClick={publish}>
              {busy === "publish" ? "下发中…" : "下发"}
            </button>
          </div>
        </section>

        {error ? <p className="banner">{error}</p> : null}
        {message ? <p className="ok-banner">{message}</p> : null}
      </section>
    );
  }

  return (
    <section className="page catalog-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">专家</p>
          <h2>配置并下发内置专家</h2>
          <p className="hint">先改配置，再下发给全部或指定用户。</p>
        </div>
        <p className="count-pill">{filtered.length} 个</p>
      </header>

      <CatalogToolbar search={query} onSearch={setQuery} placeholder="搜索专家" />

      {filtered.length === 0 ? (
        <CatalogEmpty
          title={experts.length === 0 ? "没有内置专家" : "没有匹配的专家"}
          hint={experts.length === 0 ? "代码里的 BUNDLED_EXPERTS 会显示在这里。" : "换个关键词再试试。"}
        />
      ) : (
        <>
          <CatalogGrid>
            {visible.map((item) => (
              <CatalogCard
                key={item.id}
                title={item.live.name}
                badge={audienceLabel(item)}
                description={snippet(item.live.description, 90)}
                meta={item.live.title || item.live.industry || item.slug}
                example={item.live.examplePrompts?.[0] ? snippet(item.live.examplePrompts[0], 36) : undefined}
                onOpen={() => setSelectedId(item.id)}
                actions={
                  <button type="button" className="ghost" onClick={() => setSelectedId(item.id)}>
                    配置
                  </button>
                }
              />
            ))}
          </CatalogGrid>
          <CatalogPager page={listPage} total={filtered.length} onPage={setPage} />
        </>
      )}
    </section>
  );
}

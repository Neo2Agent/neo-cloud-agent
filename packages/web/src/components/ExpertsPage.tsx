import { useEffect, useMemo, useState } from "react";
import {
  canEditExpert,
  expertPickerLabel,
  expertVisibilityLabel,
  type Expert,
  type ExpertTeam,
} from "@neo-cloud-agent/contracts/expert";
import { api, readJson } from "../api";
import { clampPage, filterByQuery, paginate, snippet } from "../catalog.js";
import { IconBack } from "../icons.js";
import { useConfirm } from "../feedback.js";
import { CatalogCard, CatalogEmpty, CatalogForm, CatalogGrid, CatalogModal, CatalogPager, CatalogTabs, CatalogToolbar } from "./Catalog.js";

type Props = {
  token: string;
  userId?: string;
  selectedId?: string | null;
  projectId?: string | null;
  onOpenExpert: (id: string | null) => void;
  onSummon: (pick: { expertId?: string; expertTeamId?: string; name: string }) => void;
};

type Draft = {
  name: string;
  description: string;
  persona: string;
  methodology: string;
  deliverables: string;
};

type ExpertTab = "center" | "mine" | "teams";

const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  persona: "",
  methodology: "",
  deliverables: "",
});

export function ExpertsPage({ token, userId, selectedId, projectId, onOpenExpert, onSummon }: Props) {
  const [experts, setExperts] = useState<Expert[]>([]);
  const [teams, setTeams] = useState<ExpertTeam[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [edit, setEdit] = useState<Draft>(emptyDraft);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<ExpertTab>("center");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const confirm = useConfirm();

  const selected = experts.find((item) => item.id === selectedId || item.slug === selectedId) ?? null;
  const mine = useMemo(() => experts.filter((item) => item.visibility === "user"), [experts]);
  const center = useMemo(
    () => experts.filter((item) => item.visibility === "bundled" || item.visibility === "project"),
    [experts],
  );

  const filteredExperts = useMemo(() => {
    const pool = tab === "mine" ? mine : center;
    return filterByQuery(pool, query, (item) => [
      item.name,
      item.title,
      item.description,
      item.industry,
      ...(item.examplePrompts ?? []),
    ]);
  }, [tab, mine, center, query]);
  const filteredTeams = useMemo(
    () => filterByQuery(teams, query, (item) => [item.name, item.description, item.lead?.name]),
    [teams, query],
  );
  const filteredCount = tab === "teams" ? filteredTeams.length : filteredExperts.length;
  const listPage = clampPage(page, filteredCount);
  const visibleExperts = paginate(filteredExperts, listPage);
  const visibleTeams = paginate(filteredTeams, listPage);

  const refresh = async () => {
    const queryStr = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const [expertRes, teamRes] = await Promise.all([
      api(token, `/v1/experts${queryStr}`),
      api(token, "/v1/expert-teams"),
    ]);
    if (expertRes.ok) {
      setExperts((await readJson<{ experts?: Expert[] }>(expertRes)).experts ?? []);
    }
    if (teamRes.ok) {
      setTeams((await readJson<{ teams?: ExpertTeam[] }>(teamRes)).teams ?? []);
    }
  };

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [token, projectId]);

  useEffect(() => {
    setPage(1);
  }, [query, tab]);

  useEffect(() => {
    if (!selected) {
      setEdit(emptyDraft());
      return;
    }
    setEdit({
      name: selected.name,
      description: selected.description,
      persona: selected.persona,
      methodology: selected.methodology,
      deliverables: selected.deliverables,
    });
  }, [selected?.id]);

  const create = () => {
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    setError("");
    void api(token, "/v1/experts", {
      method: "POST",
      body: JSON.stringify({
        ...draft,
        visibility: "user",
      }),
    })
      .then(async (res) => {
        const body = await readJson<Expert & { error?: string }>(res);
        if (!res.ok) throw new Error(body.error || "创建失败");
        setDraft(emptyDraft());
        setCreateOpen(false);
        setTab("mine");
        await refresh();
        onOpenExpert(body.id);
      })
      .catch((item) => setError(item instanceof Error ? item.message : "创建失败"))
      .finally(() => setBusy(false));
  };

  const save = () => {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    void api(token, `/v1/experts/${selected.id}`, {
      method: "POST",
      body: JSON.stringify(edit),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await readJson<{ error?: string }>(res)).error || "保存失败");
        await refresh();
      })
      .catch((item) => setError(item instanceof Error ? item.message : "保存失败"))
      .finally(() => setBusy(false));
  };

  const remove = () => {
    if (!selected || busy) return;
    void confirm({
      title: "删除这个专家？",
      message: "删除后不能恢复。已开的对话不受影响。",
      confirmLabel: "删除",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      setBusy(true);
      setError("");
      void api(token, `/v1/experts/${selected.id}`, { method: "DELETE" })
        .then(async (res) => {
          if (!res.ok) throw new Error((await readJson<{ error?: string }>(res)).error || "删除失败");
          onOpenExpert(null);
          await refresh();
        })
        .catch((item) => setError(item instanceof Error ? item.message : "删除失败"))
        .finally(() => setBusy(false));
    });
  };

  if (selected) {
    const editable = Boolean(userId && canEditExpert(selected, { userId }));
    return (
      <section className="proj-page catalog-page" id="experts-page">
        <header className="proj-page-head">
          <div>
            <button className="catalog-back" type="button" onClick={() => onOpenExpert(null)}>
              <IconBack />
              全部专家
            </button>
            <h2>{selected.name}</h2>
            <p className="hint">
              {expertVisibilityLabel(selected.visibility)}
              {selected.title ? ` · ${selected.title}` : ""}
            </p>
          </div>
          <button
            className="proj-add"
            type="button"
            onClick={() => onSummon({ expertId: selected.id, name: selected.name })}
          >
            召唤
          </button>
        </header>
        <form
          className="proj-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (editable) save();
          }}
        >
          <p className="proj-card-title">{editable ? "编辑专家" : "角色包"}</p>
          <p className="hint">{selected.description}</p>
          <label>
            <span>名称</span>
            <input value={edit.name} disabled={!editable} onChange={(event) => setEdit({ ...edit, name: event.target.value })} />
          </label>
          <label>
            <span>简介</span>
            <input
              value={edit.description}
              disabled={!editable}
              onChange={(event) => setEdit({ ...edit, description: event.target.value })}
            />
          </label>
          <label>
            <span>人设</span>
            <textarea
              value={edit.persona}
              disabled={!editable}
              rows={5}
              onChange={(event) => setEdit({ ...edit, persona: event.target.value })}
            />
          </label>
          <label>
            <span>方法论</span>
            <textarea
              value={edit.methodology}
              disabled={!editable}
              rows={5}
              onChange={(event) => setEdit({ ...edit, methodology: event.target.value })}
            />
          </label>
          <label>
            <span>交付标准</span>
            <textarea
              value={edit.deliverables}
              disabled={!editable}
              rows={5}
              onChange={(event) => setEdit({ ...edit, deliverables: event.target.value })}
            />
          </label>
          {editable ? (
            <div className="expert-actions">
              <button className="proj-add" type="submit" disabled={busy}>
                保存
              </button>
              <button className="ghost danger" type="button" disabled={busy} onClick={remove}>
                删除
              </button>
            </div>
          ) : (
            <p className="hint">内置专家不能改。新对话时选它，就会按这套角色干活。</p>
          )}
        </form>
        {error ? <p className="auth-error">{error}</p> : null}
      </section>
    );
  }

  const emptyCopy =
    tab === "mine"
      ? { title: mine.length === 0 ? "还没有个人专家" : "没有匹配的专家", hint: mine.length === 0 ? "写人设、方法论和交付标准，变成你自己的角色包。" : "换个关键词再试试。" }
      : tab === "teams"
        ? { title: teams.length === 0 ? "还没有专家团" : "没有匹配的专家团", hint: teams.length === 0 ? "团长编排成员，成员走现有子会话。" : "换个关键词再试试。" }
        : { title: center.length === 0 ? "专家中心是空的" : "没有匹配的专家", hint: center.length === 0 ? "内置专家会显示在这里，点召唤就能按这个角色开对话。" : "换个关键词再试试。" };

  return (
    <section className="proj-page catalog-page" id="experts-page">
      <header className="proj-page-head">
        <div>
          <p className="eyebrow">专家</p>
          <h2>换角色干活</h2>
          <p className="hint">选一个专家或专家团，再开对话。一次对话只绑一个角色。</p>
        </div>
      </header>

      <CatalogTabs
        tabs={[
          { id: "center", label: "专家中心", count: center.length },
          { id: "mine", label: "我的专家", count: mine.length },
          { id: "teams", label: "专家团", count: teams.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <CatalogToolbar
        search={query}
        onSearch={setQuery}
        placeholder={tab === "teams" ? "搜索专家团" : "搜索专家"}
        actionLabel={tab === "teams" ? undefined : "新建专家"}
        onAction={
          tab === "teams"
            ? undefined
            : () => {
                setDraft(emptyDraft());
                setCreateOpen(true);
              }
        }
      />

      {filteredCount === 0 ? (
        <CatalogEmpty
          title={emptyCopy.title}
          hint={emptyCopy.hint}
          action={
            tab !== "teams" && (tab === "mine" ? mine : center).length === 0 ? (
              <button
                className="proj-add"
                type="button"
                onClick={() => {
                  setDraft(emptyDraft());
                  setCreateOpen(true);
                }}
              >
                新建专家
              </button>
            ) : null
          }
        />
      ) : tab === "teams" ? (
        <>
          <CatalogGrid>
            {visibleTeams.map((item) => (
              <CatalogCard
                key={item.id}
                title={item.name}
                description={snippet(item.description, 90)}
                badge="团"
                meta={item.memberSlugs.length ? `${item.memberSlugs.length} 位成员` : "团长编排"}
                example={item.workflows?.[0]?.name}
                actions={
                  <button type="button" className="quiet-btn primary" onClick={() => onSummon({ expertTeamId: item.id, name: item.name })}>
                    召唤
                  </button>
                }
              />
            ))}
          </CatalogGrid>
          <CatalogPager page={listPage} total={filteredTeams.length} onPage={setPage} />
        </>
      ) : (
        <>
          <CatalogGrid>
            {visibleExperts.map((item) => (
              <CatalogCard
                key={item.id}
                title={expertPickerLabel(item)}
                description={snippet(item.description, 90)}
                badge={expertVisibilityLabel(item.visibility)}
                meta={item.title || item.industry}
                example={item.examplePrompts?.[0] ? snippet(item.examplePrompts[0], 36) : undefined}
                onOpen={() => onOpenExpert(item.id)}
                actions={
                  <button type="button" className="quiet-btn primary" onClick={() => onSummon({ expertId: item.id, name: item.name })}>
                    召唤
                  </button>
                }
              />
            ))}
          </CatalogGrid>
          <CatalogPager page={listPage} total={filteredExperts.length} onPage={setPage} />
        </>
      )}

      <CatalogModal
        title="新建专家"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        wide
        footer={
          <>
            <button type="button" className="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button type="button" className="proj-add" disabled={busy || !draft.name.trim()} onClick={create}>
              新建专家
            </button>
          </>
        }
      >
        <CatalogForm
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <label>
            <span>名称</span>
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：发布检查" />
          </label>
          <label>
            <span>简介</span>
            <input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="一句话说明它干什么"
            />
          </label>
          <label>
            <span>人设</span>
            <textarea
              value={draft.persona}
              rows={4}
              onChange={(event) => setDraft({ ...draft, persona: event.target.value })}
              placeholder="You are …"
            />
          </label>
          <label>
            <span>方法论</span>
            <textarea
              value={draft.methodology}
              rows={4}
              onChange={(event) => setDraft({ ...draft, methodology: event.target.value })}
              placeholder="先读什么，再产出什么"
            />
          </label>
          <label>
            <span>交付标准</span>
            <textarea
              value={draft.deliverables}
              rows={4}
              onChange={(event) => setDraft({ ...draft, deliverables: event.target.value })}
              placeholder="## Findings"
            />
          </label>
        </CatalogForm>
      </CatalogModal>
      {error ? <p className="auth-error">{error}</p> : null}
    </section>
  );
}

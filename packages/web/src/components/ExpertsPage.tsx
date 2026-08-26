import { useEffect, useMemo, useState } from "react";
import {
  canEditExpert,
  expertPickerLabel,
  expertVisibilityLabel,
  type Expert,
  type ExpertTeam,
} from "@neo-cloud-agent/contracts/expert";
import { api, readJson } from "../api";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = experts.find((item) => item.id === selectedId || item.slug === selectedId) ?? null;
  const mine = useMemo(() => experts.filter((item) => item.visibility === "user"), [experts]);
  const bundled = useMemo(() => experts.filter((item) => item.visibility === "bundled"), [experts]);
  const projectExperts = useMemo(() => experts.filter((item) => item.visibility === "project"), [experts]);

  const refresh = async () => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const [expertRes, teamRes] = await Promise.all([
      api(token, `/v1/experts${query}`),
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
  };

  if (selected) {
    const editable = Boolean(userId && canEditExpert(selected, { userId }));
    return (
      <section className="proj-page" id="experts-page">
        <header className="proj-page-head">
          <div>
            <button className="ghost" type="button" onClick={() => onOpenExpert(null)}>
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
              <button className="ghost" type="button" disabled={busy} onClick={remove}>
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

  return (
    <section className="proj-page" id="experts-page">
      <header className="proj-page-head">
        <div>
          <p className="eyebrow">专家</p>
          <h2>换角色干活</h2>
          <p className="hint">选一个专家或专家团，再开对话。一次对话只绑一个角色。</p>
        </div>
        <p className="proj-count">{experts.length + teams.length} 个</p>
      </header>

      <form
        className="proj-card"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <p className="proj-card-title">我的专家</p>
        <p className="hint">写人设、方法论和交付标准。数据存在控制面，生产走 MySQL。</p>
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
        <button className="proj-add" type="submit" disabled={busy || !draft.name.trim()}>
          新建专家
        </button>
      </form>

      <ExpertGroup title="内置专家" items={bundled} onOpen={onOpenExpert} onSummon={onSummon} />
      {projectExperts.length > 0 ? (
        <ExpertGroup title="项目专家" items={projectExperts} onOpen={onOpenExpert} onSummon={onSummon} />
      ) : null}
      {mine.length > 0 ? <ExpertGroup title="我的专家" items={mine} onOpen={onOpenExpert} onSummon={onSummon} /> : null}

      <div className="proj-card">
        <p className="proj-card-title">专家团</p>
        <p className="hint">团长编排成员，成员走现有子会话。目前只有内置团。</p>
        <ul className="expert-grid">
          {teams.map((item) => (
            <li key={item.id}>
              <button type="button" className="expert-card" onClick={() => onSummon({ expertTeamId: item.id, name: item.name })}>
                <strong>{item.name}</strong>
                <span className="expert-badge">团</span>
                <p>{item.description}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {error ? <p className="auth-error">{error}</p> : null}
    </section>
  );
}

function ExpertGroup({
  title,
  items,
  onOpen,
  onSummon,
}: {
  title: string;
  items: Expert[];
  onOpen: (id: string) => void;
  onSummon: (pick: { expertId?: string; expertTeamId?: string; name: string }) => void;
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
                <strong>{expertPickerLabel(item)}</strong>
                <span className="expert-badge">{expertVisibilityLabel(item.visibility)}</span>
                <p>{item.description}</p>
              </button>
              <button type="button" className="ghost" onClick={() => onSummon({ expertId: item.id, name: item.name })}>
                召唤
              </button>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

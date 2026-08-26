import { canEditExpert, expertPickerLabel, expertVisibilityLabel, type Expert, type ExpertTeam } from "@neo-cloud-agent/contracts/expert";
import { useEffect, useMemo, useState } from "react";
import { api, readJson } from "./api";
import { IconPlus } from "./icons";
import { Modal, Page } from "./pages";

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

export function ExpertsPage({
  token,
  userId,
  projectId,
  onSummon,
}: {
  token: string;
  userId: string;
  projectId?: string | null;
  onSummon: (pick: { expertId?: string; expertTeamId?: string; name: string }) => void;
}) {
  const [experts, setExperts] = useState<Expert[]>([]);
  const [teams, setTeams] = useState<ExpertTeam[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Expert | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mine = useMemo(() => experts.filter((item) => item.visibility === "user"), [experts]);
  const bundled = useMemo(() => experts.filter((item) => item.visibility === "bundled"), [experts]);
  const projectExperts = useMemo(() => experts.filter((item) => item.visibility === "project"), [experts]);

  const refresh = async () => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const [expertRes, teamRes] = await Promise.all([
      api(token, `/v1/experts${query}`),
      api(token, "/v1/expert-teams"),
    ]);
    if (expertRes.ok) setExperts((await readJson<{ experts?: Expert[] }>(expertRes)).experts ?? []);
    if (teamRes.ok) setTeams((await readJson<{ teams?: ExpertTeam[] }>(teamRes)).teams ?? []);
  };

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [token, projectId]);

  const openEdit = (expert: Expert) => {
    setEditing(expert);
    setDraft({
      name: expert.name,
      description: expert.description,
      persona: expert.persona,
      methodology: expert.methodology,
      deliverables: expert.deliverables,
    });
  };

  const submitDraft = async (id?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api(token, id ? `/v1/experts/${id}` : "/v1/experts", {
        method: "POST",
        body: JSON.stringify(id ? draft : { ...draft, visibility: "user" }),
      });
      const body = await readJson<Expert & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "保存失败");
      setCreating(false);
      setEditing(null);
      setDraft(emptyDraft());
      await refresh();
    } catch (item) {
      setError(item instanceof Error ? item.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (expert: Expert) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api(token, `/v1/experts/${expert.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await readJson<{ error?: string }>(response)).error || "删除失败");
      setEditing(null);
      await refresh();
    } catch (item) {
      setError(item instanceof Error ? item.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <header className="dash-head">
        <div>
          <h1>专家</h1>
          <p>换角色干活。选专家或专家团后再开对话，一次只绑一个。</p>
        </div>
        <button
          type="button"
          className="dash-create"
          onClick={() => {
            setDraft(emptyDraft());
            setCreating(true);
          }}
        >
          <IconPlus size={16} />
          新建专家
        </button>
      </header>
      <div className="page-body expert-page-body">
        <ExpertGroup title="内置专家" items={bundled} userId={userId} onSummon={onSummon} onEdit={openEdit} />
        {projectExperts.length > 0 ? (
          <ExpertGroup title="项目专家" items={projectExperts} userId={userId} onSummon={onSummon}           onEdit={openEdit} />
        ) : null}
        <ExpertGroup title="我的专家" items={mine} userId={userId} onSummon={onSummon} onEdit={openEdit} empty="还没有个人专家。点右上角新建。" />
        <section>
          <h2 className="expert-section">专家团</h2>
          <ul className="expert-grid">
            {teams.map((item) => (
              <li key={item.id} className="dash-card">
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.description}</p>
                </div>
                <div className="card-actions">
                  <button type="button" onClick={() => onSummon({ expertTeamId: item.id, name: item.name })}>
                    召唤
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
        {error ? <p className="error">{error}</p> : null}
      </div>
      {creating || editing ? (
        <Modal
          title={editing ? `编辑 ${editing.name}` : "新建专家"}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        >
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitDraft(editing?.id);
            }}
          >
            <label>
              <span>名称</span>
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
            </label>
            <label>
              <span>简介</span>
              <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} required />
            </label>
            <label>
              <span>人设</span>
              <textarea value={draft.persona} rows={4} onChange={(event) => setDraft({ ...draft, persona: event.target.value })} required />
            </label>
            <label>
              <span>方法论</span>
              <textarea value={draft.methodology} rows={4} onChange={(event) => setDraft({ ...draft, methodology: event.target.value })} required />
            </label>
            <label>
              <span>交付标准</span>
              <textarea value={draft.deliverables} rows={4} onChange={(event) => setDraft({ ...draft, deliverables: event.target.value })} required />
            </label>
            <div className="modal-actions">
              {editing && canEditExpert(editing, { userId }) ? (
                <button type="button" className="ghost" disabled={busy} onClick={() => void remove(editing)}>
                  删除
                </button>
              ) : null}
              <button type="submit" className="dash-create" disabled={busy}>
                {busy ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
}

function ExpertGroup({
  title,
  items,
  userId,
  empty,
  onSummon,
  onEdit,
}: {
  title: string;
  items: Expert[];
  userId: string;
  empty?: string;
  onSummon: (pick: { expertId?: string; expertTeamId?: string; name: string }) => void;
  onEdit: (expert: Expert) => void;
}) {
  return (
    <section>
      <h2 className="expert-section">{title}</h2>
      {items.length === 0 ? (
        <p className="hint">{empty ?? "暂无"}</p>
      ) : (
        <ul className="expert-grid">
          {items.map((item) => (
            <li key={item.id} className="dash-card">
              <div>
                <strong>{expertPickerLabel(item)}</strong>
                <p>
                  {expertVisibilityLabel(item.visibility)} · {item.description}
                </p>
              </div>
              <div className="card-actions">
                <button type="button" onClick={() => onSummon({ expertId: item.id, name: item.name })}>
                  召唤
                </button>
                {canEditExpert(item, { userId }) ? (
                  <button
                    type="button"
                    onClick={() => {
                      onEdit(item);
                    }}
                  >
                    编辑
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

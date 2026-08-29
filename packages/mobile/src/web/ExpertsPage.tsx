import { useMemo, useState } from "react";
import { canEditExpert, expertPickerLabel, type Expert, type ExpertTeam } from "@neo-cloud-agent/contracts/expert";
import { IslandButton, IslandInput } from "./island";
import { Modal, Page } from "./chrome";

type Draft = { name: string; description: string; persona: string; methodology: string; deliverables: string };

const emptyDraft = (): Draft => ({ name: "", description: "", persona: "", methodology: "", deliverables: "" });

export function ExpertsPage(props: {
  experts: Expert[];
  teams: ExpertTeam[];
  userId: string;
  error: string;
  onBack: () => void;
  onSummon: (pick: { expertId?: string; expertTeamId?: string; name: string }) => void;
  onSave: (draft: Draft, id?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Expert | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const mine = useMemo(() => props.experts.filter((item) => item.visibility === "user"), [props.experts]);
  const bundled = useMemo(() => props.experts.filter((item) => item.visibility === "bundled"), [props.experts]);

  const startCreate = () => {
    setEditing(null);
    setDraft(emptyDraft());
    setOpen(true);
  };

  return (
    <Page
      title="专家"
      onBack={props.onBack}
      action={
        <IslandButton type="primary" onClick={startCreate}>
          新建
        </IslandButton>
      }
    >
      <p className="hint">选专家后再开对话，一次只绑一个。</p>
      <Group title="内置专家" items={bundled} userId={props.userId} onSummon={props.onSummon} onEdit={(item) => { setEditing(item); setDraft(item); setOpen(true); }} />
      <Group title="我的专家" items={mine} userId={props.userId} onSummon={props.onSummon} onEdit={(item) => { setEditing(item); setDraft(item); setOpen(true); }} empty="还没有个人专家。" />
      {props.teams.length > 0 ? <h3 className="group-title">专家团</h3> : null}
      {props.teams.map((item) => (
        <div key={item.id} className="dash-card">
          <div>
            <strong>{item.name}</strong>
            <p>{item.description}</p>
          </div>
          <IslandButton type="text" onClick={() => props.onSummon({ expertTeamId: item.id, name: item.name })}>
            召唤
          </IslandButton>
        </div>
      ))}
      {props.error ? <p className="error">{props.error}</p> : null}
      {open ? (
        <Modal title={editing ? `编辑 ${editing.name}` : "新建专家"} onClose={() => setOpen(false)}>
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              void props.onSave(draft, editing?.id).then(() => setOpen(false)).finally(() => setBusy(false));
            }}
          >
            <label>
              名称
              <IslandInput value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
            </label>
            <label>
              简介
              <IslandInput value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} required />
            </label>
            <label>
              人设
              <textarea className="island-area" value={draft.persona} rows={3} onChange={(event) => setDraft({ ...draft, persona: event.target.value })} required />
            </label>
            <label>
              方法论
              <textarea className="island-area" value={draft.methodology} rows={3} onChange={(event) => setDraft({ ...draft, methodology: event.target.value })} required />
            </label>
            <label>
              交付标准
              <textarea className="island-area" value={draft.deliverables} rows={3} onChange={(event) => setDraft({ ...draft, deliverables: event.target.value })} required />
            </label>
            <div className="modal-actions">
              <IslandButton type="text" onClick={() => setOpen(false)}>
                取消
              </IslandButton>
              <IslandButton type="primary" submit disabled={busy}>
                {busy ? "保存中…" : "保存"}
              </IslandButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
}

function Group(props: {
  title: string;
  items: Expert[];
  userId: string;
  empty?: string;
  onSummon: (pick: { expertId?: string; name: string }) => void;
  onEdit: (item: Expert) => void;
}) {
  return (
    <>
      <h3 className="group-title">{props.title}</h3>
      {props.items.length === 0 && props.empty ? <p className="empty">{props.empty}</p> : null}
      {props.items.map((item) => (
        <div key={item.id} className="dash-card">
          <div>
            <strong>{expertPickerLabel(item)}</strong>
            <p>{item.description}</p>
          </div>
          <div className="card-actions">
            {canEditExpert(item, { userId: props.userId }) ? (
              <IslandButton type="text" onClick={() => props.onEdit(item)}>
                编辑
              </IslandButton>
            ) : null}
            <IslandButton type="text" onClick={() => props.onSummon({ expertId: item.id, name: item.name })}>
              召唤
            </IslandButton>
          </div>
        </div>
      ))}
    </>
  );
}

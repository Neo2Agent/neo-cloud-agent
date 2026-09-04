import { useMemo, useState } from "react";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { runTitle } from "../format";
import { runRowMeta } from "../session";
import { IslandButton, IslandInput } from "./island";
import { Modal, Page } from "./chrome";

export function ProjectsPage(props: {
  items: Project[];
  runs: Run[];
  selectedId: string | null;
  error: string;
  onBack: () => void;
  onSelect: (id: string | null) => void;
  onCreate: (name: string, instruction: string) => Promise<void>;
  onOpenRun: (id: string) => void;
  onNewInProject: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const visible = useMemo(
    () => props.items.filter((item) => !query.trim() || item.name.toLowerCase().includes(query.trim().toLowerCase())),
    [props.items, query],
  );
  const selected = props.items.find((item) => item.id === props.selectedId) ?? null;
  const projectRuns = selected ? props.runs.filter((run) => run.projectId === selected.id) : [];

  if (selected) {
    return (
      <Page
        title={selected.name}
        onBack={() => props.onSelect(null)}
        action={
          <IslandButton type="primary" onClick={props.onNewInProject}>
            新对话
          </IslandButton>
        }
      >
        <p className="hint">{selected.instruction || "还没有项目指令。"}</p>
        {projectRuns.length === 0 ? <p className="empty">这个项目还没有对话。</p> : null}
        {projectRuns.map((run) => (
          <button key={run.id} className="dash-card" type="button" onClick={() => props.onOpenRun(run.id)}>
            <div>
              <strong>{runTitle(run)}</strong>
              <p>{runRowMeta(run)}</p>
            </div>
          </button>
        ))}
      </Page>
    );
  }

  return (
    <Page
      title="项目"
      onBack={props.onBack}
      action={
        <IslandButton type="primary" onClick={() => setOpen(true)}>
          新建
        </IslandButton>
      }
    >
      <IslandInput value={query} placeholder="搜索项目" onChange={(event) => setQuery(event.target.value)} />
      {visible.length === 0 ? <p className="empty">还没有项目。</p> : null}
      {visible.map((item) => (
        <button key={item.id} className="dash-card" type="button" onClick={() => props.onSelect(item.id)}>
          <div>
            <strong>{item.name}</strong>
            <p>{item.instruction || "多人协同"}</p>
          </div>
        </button>
      ))}
      {props.error ? <p className="error">{props.error}</p> : null}
      {open ? (
        <Modal title="新建项目" onClose={() => setOpen(false)}>
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim() || busy) return;
              setBusy(true);
              void props
                .onCreate(name.trim(), instruction)
                .then(() => {
                  setName("");
                  setInstruction("");
                  setOpen(false);
                })
                .finally(() => setBusy(false));
            }}
          >
            <label>
              名称
              <IslandInput value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label>
              指令
              <textarea className="island-area" value={instruction} rows={3} onChange={(event) => setInstruction(event.target.value)} />
            </label>
            <div className="modal-actions">
              <IslandButton type="text" onClick={() => setOpen(false)}>
                取消
              </IslandButton>
              <IslandButton type="primary" submit disabled={busy || !name.trim()}>
                {busy ? "创建中…" : "创建"}
              </IslandButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
}

export function InvitePage(props: {
  projectName: string;
  status: string;
  busy: boolean;
  error: string;
  onBack: () => void;
  onJoin: () => void;
}) {
  return (
    <Page title={props.projectName || "加入项目"} onBack={props.onBack}>
      <p className="hint">
        {props.status === "pending" ? "你已经申请过了，等管理员通过。" : "用这个链接加入项目，不会自动看到别人的会话。"}
      </p>
      <IslandButton type="primary" disabled={props.busy || props.status === "pending"} onClick={props.onJoin}>
        {props.status === "pending" ? "已申请，等待通过" : props.busy ? "加入中…" : "加入项目"}
      </IslandButton>
      {props.error ? <p className="error">{props.error}</p> : null}
    </Page>
  );
}

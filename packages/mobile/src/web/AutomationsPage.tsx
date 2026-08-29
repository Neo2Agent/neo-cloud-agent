import { useState } from "react";
import { describeAutomationSchedule, type Automation } from "@neo-cloud-agent/contracts/automation";
import { SCHEDULE_PRESETS, type ScheduleKind } from "../automations";
import { IslandButton, IslandSwitch } from "./island";
import { Modal, Page } from "./chrome";

export function AutomationsPage(props: {
  items: Automation[];
  error: string;
  onBack: () => void;
  onCreate: (prompt: string, preset: ScheduleKind) => Promise<void>;
  onToggle: (item: Automation) => void;
  onOpenRun: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState<ScheduleKind>("daily_09");
  const [busy, setBusy] = useState(false);

  return (
    <Page
      title="定时任务"
      onBack={props.onBack}
      action={
        <IslandButton type="primary" onClick={() => setOpen(true)}>
          新建
        </IslandButton>
      }
    >
      <p className="hint">到点自动开一轮云端对话。</p>
      {props.items.length === 0 ? <p className="empty">还没有定时任务。</p> : null}
      {props.items.map((item) => (
        <div key={item.id} className="dash-card">
          <div>
            <strong>{item.name || item.prompt}</strong>
            <p>{describeAutomationSchedule(item.schedule)}</p>
          </div>
          <div className="card-actions">
            {item.lastRunId ? (
              <IslandButton type="text" onClick={() => props.onOpenRun(item.lastRunId!)}>
                打开上次对话
              </IslandButton>
            ) : null}
            <IslandSwitch checked={item.enabled} aria-label={item.enabled ? "暂停" : "开启"} onChange={() => props.onToggle(item)} />
          </div>
        </div>
      ))}
      {props.error ? <p className="error">{props.error}</p> : null}
      {open ? (
        <Modal title="新建任务" onClose={() => setOpen(false)}>
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!prompt.trim() || busy) return;
              setBusy(true);
              void props
                .onCreate(prompt.trim(), preset)
                .then(() => {
                  setPrompt("");
                  setOpen(false);
                })
                .finally(() => setBusy(false));
            }}
          >
            <label>
              要做的事
              <textarea className="island-area" value={prompt} rows={3} onChange={(event) => setPrompt(event.target.value)} />
            </label>
            <div className="preset-row">
              {SCHEDULE_PRESETS.map((item) => (
                <IslandButton key={item.id} type={item.id === preset ? "primary" : "button"} onClick={() => setPreset(item.id)}>
                  {item.label}
                </IslandButton>
              ))}
            </div>
            <div className="modal-actions">
              <IslandButton type="text" onClick={() => setOpen(false)}>
                取消
              </IslandButton>
              <IslandButton type="primary" submit disabled={busy || !prompt.trim()}>
                {busy ? "创建中…" : "创建"}
              </IslandButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
}

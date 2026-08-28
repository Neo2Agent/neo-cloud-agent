import { Select } from "@neo-cloud-agent/ui";
import type { Desk } from "@neo-cloud-agent/contracts/desk";
import type { DeskTarget } from "../desk";

type Props = {
  target: DeskTarget;
  canRunLocal: boolean;
  folder?: string;
  /** Machines that registered themselves and still hold a connection. */
  desks?: Desk[];
  onTarget: (target: DeskTarget) => void;
  onPickFolder?: () => void;
};

type MachineOption = { deskId: string; workspaceId: string; label: string };

/** Only a connected machine that allows remote work can take a run. */
function machineOptions(desks: Desk[]): MachineOption[] {
  const out: MachineOption[] = [];
  for (const desk of desks) {
    if (!desk.online || desk.allowRemote !== true) {
      continue;
    }
    for (const workspace of desk.workspaces ?? []) {
      out.push({ deskId: desk.id, workspaceId: workspace.id, label: `${desk.name} · ${workspace.name}` });
    }
  }
  return out;
}

export function TargetPicker({ target, canRunLocal, folder, desks = [], onTarget, onPickFolder }: Props) {
  const machines = machineOptions(desks);
  const local = target.kind === "desk";
  const insideDesk = canRunLocal;
  const canGoLocal = insideDesk || machines.length > 0;
  return (
    <div className="picker">
      <Select
        id="execution-target"
        size="pill"
        aria-label="目标"
        value={target.kind}
        onValueChange={(next) => {
          const kind = next as DeskTarget["kind"];
          if (kind === "desk" && !canGoLocal) return;
          onTarget({ ...target, kind });
        }}
        options={[
          { value: "cloud", label: "云端" },
          {
            value: "desk",
            label: canGoLocal ? "本机" : "本机（先在 Desk 里绑定文件夹）",
            disabled: !canGoLocal,
          },
          { value: "remote", label: "远程机（P3）", disabled: true },
        ]}
      />
      {local && insideDesk ? (
        <button type="button" className="ghost picker-extra" onClick={onPickFolder}>
          {folder || "选择文件夹…"}
        </button>
      ) : null}
      {local && !insideDesk ? (
        <Select
          className="picker-extra"
          size="pill"
          aria-label="选择一台电脑"
          placeholder="选择一台电脑…"
          value={target.workspaceId ?? ""}
          onValueChange={(next) => {
            const picked = machines.find((item) => item.workspaceId === next);
            if (!picked) return;
            onTarget({ ...target, kind: "desk", deskId: picked.deskId, workspaceId: picked.workspaceId });
          }}
          options={machines.map((item) => ({ value: item.workspaceId, label: item.label }))}
        />
      ) : null}
    </div>
  );
}

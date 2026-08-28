import type { Run } from "@neo-cloud-agent/contracts/run";
import { preview, slotLabel } from "../format";
import { isActiveRunStatus } from "../turn";
import type { VmSlotView } from "./Sidebar";

type Props = {
  slots: VmSlotView[];
  backend: string;
  currentRunId: string | null;
  runs: Run[];
  onOpenRun: (id: string) => void;
};

export function VmSlots({ slots, backend, currentRunId, runs, onOpenRun }: Props) {
  return (
    <section className="vm-block">
      <p className="eyebrow">虚拟机</p>
      <div className="vm-rail" id="vm-rail" aria-label="VM 槽">
        {slots.length === 0 ? (
          <p className="hint">{backend === "none" ? "当前未启用 VM" : "VM 槽还在初始化"}</p>
        ) : (
          slots.map((slot) => {
            const occupant = runs.find((run) => run.id === slot.runId || run.vmSlotId === slot.id);
            const held = slot.status === "busy" || Boolean(slot.runId);
            const current = Boolean(currentRunId && (slot.runId === currentRunId || occupant?.id === currentRunId));
            const running = Boolean(occupant && isActiveRunStatus(occupant.status));
            const title = occupant ? preview(occupant.prompt) : held ? slot.runId?.slice(0, 8) : "空闲";
            const occupancy = running ? "占用" : held ? "待命" : "空闲";
            return (
              <article
                key={slot.id}
                className="vm-slot"
                data-busy={String(running)}
                data-held={String(held && !running)}
                data-active={String(running)}
                data-current={String(current)}
                data-open={occupant?.id || slot.runId || undefined}
                onClick={() => {
                  const id = occupant?.id || slot.runId;
                  if (id) onOpenRun(id);
                }}
              >
                <strong>{slotLabel(slot.id)}</strong>
                <small>
                  {occupancy} · {title}
                </small>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

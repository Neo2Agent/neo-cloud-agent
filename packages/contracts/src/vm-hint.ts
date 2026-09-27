const SLOT_ID_PATTERN = /^slot-(\d+)$/;
const VM_HINT_DISABLED = "未启用 VM 槽。";
const LOOP_BACKEND_LABEL = "loop 挂载";

export function slotLabel(id?: string | null): string {
  const raw = String(id || "");
  const match = SLOT_ID_PATTERN.exec(raw);
  if (match) return `VM ${Number(match[1]) + 1}`;
  return raw || "未分配";
}

export function describeVmBackend(backend?: string | null): string {
  return backend === "loop" ? LOOP_BACKEND_LABEL : backend || "vm";
}

/**
 * Composer / queue copy for cloud VM slots.
 * Empty `total` and no slots means the host has not enabled the pool.
 */
export function describeVmHint(input: {
  total: number;
  busy: number;
  slotCount: number;
  backend?: string | null;
  currentSlot?: string | null;
}): string {
  const backend = describeVmBackend(input.backend);
  const total = input.total || input.slotCount;
  if (!input.total && input.slotCount === 0) {
    return VM_HINT_DISABLED;
  }
  if (input.currentSlot) {
    return `当前对话占用 ${slotLabel(input.currentSlot)}（${input.currentSlot}，${backend}）`;
  }
  const idle = Math.max(0, total - input.busy);
  if (idle > 0) {
    return `${idle}/${total} 个 VM 空闲，发送后占用其中一个（${backend}）。`;
  }
  return `${total} 个 VM 都在忙。新对话会排队，有空闲槽再自动开始。`;
}

import assert from "node:assert/strict";
import test from "node:test";
import { describeVmHint, slotLabel } from "./vm-hint.js";

test("slotLabel turns slot-N into a 1-based VM name", () => {
  assert.equal(slotLabel("slot-0"), "VM 1");
  assert.equal(slotLabel("slot-3"), "VM 4");
  assert.equal(slotLabel(""), "未分配");
  assert.equal(slotLabel("custom"), "custom");
});

test("describeVmHint covers disabled, idle, busy, and current slot", () => {
  assert.equal(describeVmHint({ total: 0, busy: 0, slotCount: 0 }), "未启用 VM 槽。");
  assert.match(
    describeVmHint({ total: 2, busy: 1, slotCount: 2, backend: "loop" }),
    /1\/2 个 VM 空闲.*loop 挂载/,
  );
  assert.match(
    describeVmHint({ total: 2, busy: 2, slotCount: 2, backend: "docker" }),
    /2 个 VM 都在忙/,
  );
  assert.match(
    describeVmHint({ total: 2, busy: 1, slotCount: 2, backend: "loop", currentSlot: "slot-0" }),
    /当前对话占用 VM 1（slot-0，loop 挂载）/,
  );
});

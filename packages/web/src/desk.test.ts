import assert from "node:assert/strict";
import test from "node:test";
import { withApiBase } from "./desk.ts";

test("packaged Desk keeps /v1 on the renderer origin", () => {
  const prev = (globalThis as { window?: unknown }).window;
  (globalThis as { window: { neoDesk: { proxyApi: boolean; apiBase: string } } }).window = {
    neoDesk: { proxyApi: true, apiBase: "https://neorun.cloud" },
  };
  try {
    assert.equal(withApiBase("/v1/runs"), "/v1/runs");
  } finally {
    (globalThis as { window?: unknown }).window = prev;
  }
});

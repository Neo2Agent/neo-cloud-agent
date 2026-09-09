import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateDeskToolsProxy,
  parseDeskToolsUpgradePath,
  resetDeskToolsInFlight,
  websocketAcceptKey,
} from "./desk-tools-proxy.js";

test("parseDeskToolsUpgradePath only matches the control-plane tools path", () => {
  assert.deepEqual(parseDeskToolsUpgradePath("/v1/desks/desk_1/tools/run-9"), {
    deskId: "desk_1",
    runId: "run-9",
  });
  assert.equal(parseDeskToolsUpgradePath("/internal/tools/run-9"), undefined);
  assert.equal(parseDeskToolsUpgradePath("/v1/desks/desk_1/inbox"), undefined);
});

test("evaluateDeskToolsProxy fail-closes unless desk token, claim, and run JWT all match", () => {
  resetDeskToolsInFlight();
  const run = {
    id: "run-9",
    kernel: "agentscope" as const,
    executionTarget: { loop: "cloud" as const, tools: "desk" as const, deskId: "desk_1" },
  };
  const ok = {
    deskId: "desk_1",
    runId: "run-9",
    deskOnline: true,
    deskMatches: true,
    run,
    claimed: true,
    runJwtOk: true,
  };
  assert.deepEqual(evaluateDeskToolsProxy(ok), { ok: true });
  const denied = (input: Parameters<typeof evaluateDeskToolsProxy>[0], status: number) => {
    const result = evaluateDeskToolsProxy(input);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, status);
    }
  };
  denied({ ...ok, deskMatches: false }, 401);
  denied({ ...ok, deskOnline: false }, 409);
  denied({ ...ok, run: undefined }, 404);
  denied({ ...ok, run: { ...run, kernel: "pi" } }, 400);
  denied(
    {
      ...ok,
      run: { ...run, executionTarget: { loop: "desk", tools: "desk", deskId: "desk_1" } },
    },
    400,
  );
  denied(
    {
      ...ok,
      run: { ...run, executionTarget: { ...run.executionTarget, deskId: "desk_other" } },
    },
    403,
  );
  denied({ ...ok, claimed: false }, 409);
  denied({ ...ok, runJwtOk: false }, 401);
});

test("websocket accept key matches RFC 6455", () => {
  assert.equal(websocketAcceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

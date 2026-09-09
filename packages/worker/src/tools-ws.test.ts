import assert from "node:assert/strict";
import test from "node:test";
import { toolsWsUrl } from "./tools-ws.js";

test("same-host tools workers still dial neo-loop /internal/tools", () => {
  assert.equal(
    toolsWsUrl("http://127.0.0.1:8082", "run-1", { jwt: "r", token: "loop" }),
    "ws://127.0.0.1:8082/internal/tools/run-1?jwt=r&token=loop",
  );
});

test("Desk Remote keeps the control-plane tools path and does not append /internal/tools", () => {
  assert.equal(
    toolsWsUrl("https://neorun.cloud/v1/desks/desk_1/tools/run-9", "run-9", { jwt: "r", token: "desk" }),
    "wss://neorun.cloud/v1/desks/desk_1/tools/run-9?jwt=r&token=desk",
  );
});

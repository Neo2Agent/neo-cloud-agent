import assert from "node:assert/strict";
import test from "node:test";
import { createLeaseClient } from "./lease.js";

test("createLeaseClient registers and waits for an assignment", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const fake = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, method: init?.method });
    if (href.endsWith("/v1/desks")) {
      return new Response(JSON.stringify({ desk: { id: "desk_1" }, token: "desk_tok" }), { status: 201 });
    }
    return new Response(JSON.stringify({ assignment: { runId: "run_1" } }), { status: 200 });
  }) as typeof fetch;
  const client = createLeaseClient("http://cp", fake);
  const registered = await client.register({ userToken: "neo_sess_x", hostname: "box" });
  assert.equal(registered.deskId, "desk_1");
  const assignment = await client.waitAssignment({ deskId: "desk_1", deskToken: "desk_tok" });
  assert.equal(assignment?.runId, "run_1");
  assert.equal(calls[0]?.method, "POST");
});

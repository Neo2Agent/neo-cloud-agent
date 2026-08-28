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

test("createLeaseClient can list and prune desks with the user token", async () => {
  const calls: string[] = [];
  const fake = (async (url: string | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    if (String(url).endsWith("/v1/desks")) {
      return new Response(JSON.stringify({ desks: [{ id: "desk_old", online: false }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  const client = createLeaseClient("http://cp", fake);
  const desks = await client.listDesks("neo_sess_x");
  await client.deleteDesk("neo_sess_x", "desk_old");
  assert.equal(desks[0]?.id, "desk_old");
  assert.deepEqual(calls, ["GET http://cp/v1/desks", "DELETE http://cp/v1/desks/desk_old"]);
});

import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";

const { deskFollowUpBlockReason, deskRunVisibleRemotely, requestIsDeskClient, runVisibleToActor } = await import(
  "./visibility.js"
);

function req(input: { header?: string; url?: string } = {}): IncomingMessage {
  return {
    headers: input.header ? { "x-neo-client": input.header } : {},
    url: input.url ?? "/v1/runs",
  } as IncomingMessage;
}

const user = { kind: "user" as const, userId: "user_ada", orgId: "org_local", email: "ada@example.com", sessionId: "s1" };
const service = { kind: "service" as const, userId: "svc", orgId: "org_local" };

test("This Computer stays off the web; Remote Control is listed", () => {
  const local = {
    userId: "user_ada",
    executionTarget: { loop: "desk" as const, deskId: "desk_1" },
  };
  const remote = {
    userId: "user_ada",
    executionTarget: { loop: "desk" as const, deskId: "desk_1", remoteControl: true },
  };
  assert.equal(deskRunVisibleRemotely(local), false);
  assert.equal(runVisibleToActor(local, user, false), false);
  assert.equal(runVisibleToActor(local, user, true), true);
  assert.equal(runVisibleToActor(local, service, false), true);
  assert.equal(deskRunVisibleRemotely(remote), true);
  assert.equal(runVisibleToActor(remote, user, false), true);
});

test("cloud runs are visible without a desk client", () => {
  const run = { userId: "user_ada", executionTarget: { loop: "cloud" as const } };
  assert.equal(deskRunVisibleRemotely(run), true);
  assert.equal(runVisibleToActor(run, user, false), true);
});

test("a desk follow-up waits for the host inbox, like Cursor My Machines", () => {
  const deskRun = { userId: "user_ada", executionTarget: { loop: "desk" as const, deskId: "desk_1" } };
  assert.equal(deskFollowUpBlockReason({ userId: "user_ada", executionTarget: { loop: "cloud" } }, () => false), null);
  assert.equal(deskFollowUpBlockReason(deskRun, () => true), null);
  assert.match(deskFollowUpBlockReason(deskRun, () => false) ?? "", /离线/);
  assert.match(
    deskFollowUpBlockReason({ userId: "user_ada", executionTarget: { loop: "desk" } }, () => true) ?? "",
    /绑定电脑/,
  );
});

test("Desk identifies itself with a header or a query", () => {
  assert.equal(requestIsDeskClient(req()), false);
  assert.equal(requestIsDeskClient(req({ header: "desk" })), true);
  assert.equal(requestIsDeskClient(req({ header: "DESK" })), true);
  assert.equal(requestIsDeskClient(req({ url: "/v1/runs/r1/events?client=desk&after=t3" })), true);
  assert.equal(requestIsDeskClient(req({ url: "/v1/runs/r1/events?client=web" })), false);
});

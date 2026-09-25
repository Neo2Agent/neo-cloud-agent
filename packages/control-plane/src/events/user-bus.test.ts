import assert from "node:assert/strict";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts";
import { notifyRunListWatchers, resetUserListWatchers, runListAudience, runListSignature, subscribeUserList } from "./user-bus.js";

function run(partial: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    orgId: "org",
    userId: "host",
    projectId: "proj",
    assigneeUserId: "host",
    envId: null,
    title: "hello",
    prompt: "hello",
    status: "IDLE",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    collaborators: [{ userId: "host", email: "host@x", role: "host" }],
    ...partial,
  } as Run;
}

test("runListAudience includes host, assignee, and collaborators", () => {
  assert.deepEqual(
    runListAudience(
      run({
        userId: "a",
        assigneeUserId: "b",
        collaborators: [
          { userId: "a", email: "a@x", role: "host" },
          { userId: "c", email: "c@x", role: "editor" },
        ],
      }),
    ).sort(),
    ["a", "b", "c"],
  );
});

test("notifyRunListWatchers skips identical list signatures", () => {
  resetUserListWatchers();
  const seen: string[] = [];
  const off = subscribeUserList("host", (event) => seen.push(event.data?.reason ?? ""));
  notifyRunListWatchers(run(), "create");
  notifyRunListWatchers(run({ updatedAt: "2026-09-25T00:01:00.000Z" }), "touch");
  notifyRunListWatchers(run({ title: "renamed" }), "rename");
  assert.deepEqual(seen, ["create", "rename"]);
  assert.notEqual(runListSignature(run()), runListSignature(run({ title: "renamed" })));
  off();
  resetUserListWatchers();
});

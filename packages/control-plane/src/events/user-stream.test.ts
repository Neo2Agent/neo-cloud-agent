import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts";
import { RUN_LIST_CHANGED_KIND } from "@neo-cloud-agent/contracts/client-stream";
import { notifyRunListWatchers, resetUserListWatchers } from "./user-bus.js";
import { attachUserListStream } from "./user-stream.js";

test("attachUserListStream flushes a comment then live runs.changed", () => {
  resetUserListWatchers();
  const req = new EventEmitter();
  const chunks: string[] = [];
  const res = {
    writeHead() {
      return this;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
  };
  attachUserListStream(req as IncomingMessage, res as unknown as ServerResponse, "host");
  assert.match(chunks.join(""), /connected/);
  notifyRunListWatchers(
    {
      id: "run-stream",
      title: "live",
      status: "IDLE",
      userId: "host",
      assigneeUserId: "host",
      collaborators: [{ userId: "host", email: "h", role: "host", joinedAt: "t" }],
    } as Run,
    "rename",
  );
  assert.match(chunks.join(""), new RegExp(RUN_LIST_CHANGED_KIND));
  req.emit("close");
  resetUserListWatchers();
});

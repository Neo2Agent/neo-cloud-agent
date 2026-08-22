import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { RunEvent, TranscriptSnapshot } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "transcript-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-transcript-api-"));
process.env.OBJECT_STORE = "memory";
process.env.ACCOUNTS_REQUIRED = "0";
delete process.env.WORKER_WORKSPACE_MOUNT;

const { createApiServer } = await import("./server.js");
const { createRun, ingestEvents } = await import("../orchestrator/orchestrator.js");
const { dropHistory } = await import("../events/bus.js");
const { setObjectStoreForTests } = await import("../objects/store.js");
const { createMemoryObjectStore } = await import("../objects/memory.js");
setObjectStoreForTests(createMemoryObjectStore());

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      resolve(address.port);
    });
    server.on("error", reject);
  });
}

test("GET /transcript returns a tail snapshot without the raw event log", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(() => {
    server.close();
  });
  const run = await createRun({
    prompt: "page me",
    repoUrls: ["fixtures/toy-repo"],
  });
  const extra: RunEvent[] = Array.from({ length: 12 }, (_, index) => ({
    id: `u-${index + 2}`,
    runId: run.id,
    createdAt: new Date(Date.parse(run.createdAt) + (index + 1) * 1000).toISOString(),
    category: "agent_run",
    level: "info",
    kind: "user.message",
    title: "User message",
    data: { text: `turn ${index + 2}` },
  }));
  ingestEvents(run.id, extra);

  const tail = (await (await fetch(`http://127.0.0.1:${port}/v1/runs/${run.id}/transcript?limit=5`)).json()) as {
    events?: RunEvent[];
    snapshot: TranscriptSnapshot;
  };
  assert.equal(tail.events, undefined);
  assert.equal(tail.snapshot.messages.length, 5);
  assert.ok((tail.snapshot.remaining ?? 0) >= 8);
  assert.equal(tail.snapshot.messages.at(-1)?.text, "turn 13");
  assert.ok(tail.snapshot.lastEventId);
  assert.ok(tail.snapshot.nextBefore);

  const older = (await (
    await fetch(
      `http://127.0.0.1:${port}/v1/runs/${run.id}/transcript?limit=5&before=${encodeURIComponent(tail.snapshot.nextBefore ?? "")}`,
    )
  ).json()) as { snapshot: TranscriptSnapshot };
  assert.equal(older.snapshot.messages.length, 5);
  assert.equal(
    older.snapshot.messages.some((item) => item.id === tail.snapshot.messages[0]?.id),
    false,
  );

  const full = (await (await fetch(`http://127.0.0.1:${port}/v1/runs/${run.id}/transcript?includeEvents=1`)).json()) as {
    events: RunEvent[];
    snapshot: TranscriptSnapshot;
  };
  assert.ok(full.events.length > 5);
  assert.ok((full.snapshot.total ?? 0) >= 13);
  assert.ok(full.events.some((item) => item.kind === "user.message"));

  dropHistory(run.id);
  const cached = (await (await fetch(`http://127.0.0.1:${port}/v1/runs/${run.id}/transcript?limit=3`)).json()) as {
    events?: RunEvent[];
    snapshot: TranscriptSnapshot;
  };
  assert.equal(cached.events, undefined);
  assert.equal(cached.snapshot.messages.length, 3);
  assert.equal(cached.snapshot.messages.at(-1)?.text, "turn 13");
});

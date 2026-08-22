import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { RunEvent } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "stream-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-stream-"));
process.env.OBJECT_STORE = "memory";
process.env.ACCOUNTS_REQUIRED = "0";
delete process.env.WORKER_WORKSPACE_MOUNT;

const { createApiServer } = await import("./server.js");
const { createRun, ingestEvents } = await import("../orchestrator/orchestrator.js");
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

function attachSse(url: string, headers: http.OutgoingHttpHeaders = {}) {
  const events: RunEvent[] = [];
  let buffer = "";
  const request = http.get(url, { headers: { accept: "text/event-stream", ...headers } }, (response) => {
    response.on("data", (chunk) => {
      buffer += String(chunk);
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((item) => item.startsWith("data: "));
        if (line) {
          events.push(JSON.parse(line.slice(6)) as RunEvent);
        }
      }
    });
  });
  return {
    events,
    close() {
      request.destroy();
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for SSE");
}

test("two clients subscribe to the same live stream and can resume after an id", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(() => {
    server.close();
  });
  const run = await createRun({
    prompt: "stream me",
    repoUrls: ["fixtures/toy-repo"],
  });
  const first = attachSse(`http://127.0.0.1:${port}/v1/runs/${run.id}/events`);
  const second = attachSse(`http://127.0.0.1:${port}/v1/runs/${run.id}/events`);
  t.after(() => {
    first.close();
    second.close();
  });
  await waitFor(() => first.events.length > 0 && second.events.length > 0);
  const before = first.events.length;
  ingestEvents(run.id, [
    {
      id: "delta-1",
      runId: run.id,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: "info",
      kind: "message.delta",
      title: "Assistant text",
      data: { delta: "Hel" },
    },
    {
      id: "delta-2",
      runId: run.id,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: "info",
      kind: "message.delta",
      title: "Assistant text",
      data: { delta: "lo" },
    },
  ]);
  await waitFor(() => first.events.length >= before + 2 && second.events.length >= before + 2);
  assert.equal(first.events.at(-2)?.data?.delta, "Hel");
  assert.equal(second.events.at(-1)?.data?.delta, "lo");

  const lastId = second.events.at(-1)?.id;
  assert.ok(lastId);
  const resumed = attachSse(`http://127.0.0.1:${port}/v1/runs/${run.id}/events?after=${lastId}`, {
    "last-event-id": lastId,
  });
  t.after(() => resumed.close());
  ingestEvents(run.id, [
    {
      id: "delta-3",
      runId: run.id,
      createdAt: new Date().toISOString(),
      category: "agent_run",
      level: "info",
      kind: "message.delta",
      title: "Assistant text",
      data: { delta: "!" },
    },
  ]);
  await waitFor(() => resumed.events.some((item) => item.data?.delta === "!"));
  assert.equal(resumed.events.some((item) => item.data?.delta === "Hel"), false);

  const transcript = (await (await fetch(`http://127.0.0.1:${port}/v1/runs/${run.id}/transcript`)).json()) as {
    snapshot: { messages: Array<{ role: string; text: string; streaming?: boolean }> };
  };
  const assistant = transcript.snapshot.messages.find((item) => item.role === "assistant");
  assert.equal(assistant?.text, "Hello!");
  assert.equal(assistant?.streaming, true);

  const options = await fetch(`http://127.0.0.1:${port}/v1/runs/${run.id}/events`, { method: "OPTIONS" });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");
});

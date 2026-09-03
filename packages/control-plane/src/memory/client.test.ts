import assert from "node:assert/strict";
import test from "node:test";
import {
  addMemory,
  deleteMemory,
  Mem0Error,
  normalizeMemoryResults,
  readMem0Info,
  searchMemories,
  setMem0FetchForTests,
  updateMemory,
} from "./client.js";

test("readMem0Info needs both url and key", () => {
  assert.deepEqual(readMem0Info({}), { configured: false });
  assert.equal(readMem0Info({ MEM0_URL: "http://127.0.0.1:8888" }).configured, false);
  assert.equal(readMem0Info({ MEM0_URL: "http://127.0.0.1:8888/", MEM0_API_KEY: "m0sk_x" }).configured, true);
});

test("normalizeMemoryResults keeps timestamps and narrows metadata", () => {
  assert.deepEqual(normalizeMemoryResults(null), []);
  assert.deepEqual(
    normalizeMemoryResults({
      results: [
        {
          id: "m1",
          memory: "用 pnpm",
          score: 0.9,
          user_id: "u1",
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:01.000Z",
          metadata: { source: "agent", runId: "run_1", extra: "drop" },
        },
      ],
    }),
    [
      {
        id: "m1",
        text: "用 pnpm",
        score: 0.9,
        userId: "u1",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:01.000Z",
        metadata: { source: "agent", runId: "run_1" },
      },
    ],
  );
});

test("searchMemories uses filters-shaped body and X-API-Key", async () => {
  const previousUrl = process.env.MEM0_URL;
  const previousKey = process.env.MEM0_API_KEY;
  process.env.MEM0_URL = "http://mem0.test";
  process.env.MEM0_API_KEY = "m0sk_test";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  setMem0FetchForTests(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ results: [{ id: "m1", memory: "用 pnpm" }] }), { status: 200 });
  });
  try {
    const items = await searchMemories({ userId: "user_1", query: "包管理器", limit: 5 });
    assert.deepEqual(items, [{ id: "m1", text: "用 pnpm" }]);
    assert.equal(calls[0]?.url, "http://mem0.test/search");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers["X-API-Key"], "m0sk_test");
    assert.equal(JSON.parse(String(calls[0]?.init?.body)).user_id, "user_1");
  } finally {
    setMem0FetchForTests(null);
    if (previousUrl === undefined) delete process.env.MEM0_URL;
    else process.env.MEM0_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MEM0_API_KEY;
    else process.env.MEM0_API_KEY = previousKey;
  }
});

test("updateMemory sends PUT with user_id", async () => {
  const previousUrl = process.env.MEM0_URL;
  const previousKey = process.env.MEM0_API_KEY;
  process.env.MEM0_URL = "http://mem0.test";
  process.env.MEM0_API_KEY = "m0sk_test";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  setMem0FetchForTests(async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        results: [{ id: "m1", memory: "改用 bun", created_at: "2026-09-01T00:00:00.000Z" }],
      }),
      { status: 200 },
    );
  });
  try {
    const item = await updateMemory({
      id: "m1",
      userId: "user_1",
      text: "改用 bun",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(item.text, "改用 bun");
    assert.equal(calls[0]?.url, "http://mem0.test/memories/m1");
    assert.equal(calls[0]?.init?.method, "PUT");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      user_id: "user_1",
      text: "改用 bun",
      updated_at: "2026-09-01T00:00:00.000Z",
    });
  } finally {
    setMem0FetchForTests(null);
    if (previousUrl === undefined) delete process.env.MEM0_URL;
    else process.env.MEM0_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MEM0_API_KEY;
    else process.env.MEM0_API_KEY = previousKey;
  }
});

test("deleteMemory puts user_id on the query string", async () => {
  const previousUrl = process.env.MEM0_URL;
  const previousKey = process.env.MEM0_API_KEY;
  process.env.MEM0_URL = "http://mem0.test";
  process.env.MEM0_API_KEY = "m0sk_test";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  setMem0FetchForTests(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    await deleteMemory("m1", "user_1");
    assert.equal(calls[0]?.url, "http://mem0.test/memories/m1?user_id=user_1");
    assert.equal(calls[0]?.init?.method, "DELETE");
  } finally {
    setMem0FetchForTests(null);
    if (previousUrl === undefined) delete process.env.MEM0_URL;
    else process.env.MEM0_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MEM0_API_KEY;
    else process.env.MEM0_API_KEY = previousKey;
  }
});

test("addMemory is 503 when Mem0 is not configured", async () => {
  const previousUrl = process.env.MEM0_URL;
  const previousKey = process.env.MEM0_API_KEY;
  delete process.env.MEM0_URL;
  delete process.env.MEM0_API_KEY;
  try {
    await assert.rejects(() => addMemory({ userId: "u1", text: "用 pnpm" }), (error: unknown) => {
      assert.ok(error instanceof Mem0Error);
      assert.equal(error.status, 503);
      return true;
    });
  } finally {
    if (previousUrl === undefined) delete process.env.MEM0_URL;
    else process.env.MEM0_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MEM0_API_KEY;
    else process.env.MEM0_API_KEY = previousKey;
  }
});

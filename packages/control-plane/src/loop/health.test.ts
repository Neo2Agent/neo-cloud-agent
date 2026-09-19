import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { isNeoLoopAvailable, resetNeoLoopHealthForTest, setNeoLoopHealthForTest } from "./health.js";

test("neo-loop health probe caches success and failure", async () => {
  const previous = process.env.NEO_LOOP_PROBE;
  process.env.NEO_LOOP_PROBE = "1";
  try {
    resetNeoLoopHealthForTest();
    setNeoLoopHealthForTest(true);
    assert.equal(await isNeoLoopAvailable("http://127.0.0.1:1"), true);
    resetNeoLoopHealthForTest();
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    assert.equal(await isNeoLoopAvailable(`http://127.0.0.1:${address.port}`), true);
    server.close();
    resetNeoLoopHealthForTest();
    assert.equal(await isNeoLoopAvailable("http://127.0.0.1:1"), false);
  } finally {
    if (previous === undefined) {
      delete process.env.NEO_LOOP_PROBE;
    } else {
      process.env.NEO_LOOP_PROBE = previous;
    }
    resetNeoLoopHealthForTest();
  }
});

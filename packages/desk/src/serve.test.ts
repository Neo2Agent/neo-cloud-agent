import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { injectDeskHtml, startDeskPreview } from "./serve.js";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

test("injectDeskHtml stamps the Desk title and neoDesk bridge", () => {
  const html = injectDeskHtml("<!doctype html><html><head><title>Neo Cloud Agent</title></head><body></body></html>", 8082);
  assert.match(html, /<title>Neo Desk<\/title>/);
  assert.match(html, /window\.neoDesk/);
  assert.match(html, /canRunLocal:\s*true/);
  assert.match(html, /Desk :8082/);
});

test("desk preview injects neoDesk and proxies the control plane", async () => {
  const upstream = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, authRequired: true }));
      return;
    }
    if (req.url === "/v1/ping") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ pong: true, method: req.method }));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><head><title>Neo Cloud Agent</title></head><body>web</body></html>");
  });
  const upstreamPort = await listen(upstream);
  const preview = await startDeskPreview({
    host: "127.0.0.1",
    port: 0,
    controlPlaneUrl: `http://127.0.0.1:${upstreamPort}`,
    lease: false,
  });
  try {
    assert.notEqual(preview.port, 8080);
    const page = await fetch(preview.url);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /<title>Neo Desk<\/title>/);
    assert.match(html, /window\.neoDesk/);
    assert.match(html, new RegExp(`Desk :${preview.port}`));

    const health = await fetch(`${preview.url}/__desk/health`).then((r) => r.json() as Promise<{ port: number; canRunLocal: boolean }>);
    assert.equal(health.canRunLocal, true);
    assert.equal(health.port, preview.port);

    const proxied = await fetch(`${preview.url}/health`).then((r) => r.json() as Promise<{ ok?: boolean }>);
    assert.equal(proxied.ok, true);

    await fetch(`${preview.url}/__desk/token`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "neo_sess_test" }),
    });
    const token = await fetch(`${preview.url}/__desk/token`).then((r) => r.json() as Promise<{ token: string }>);
    assert.equal(token.token, "neo_sess_test");

    const ping = await fetch(`${preview.url}/v1/ping`, { method: "POST", body: "x" });
    assert.equal(ping.status, 200);
    assert.equal(((await ping.json()) as { pong?: boolean }).pong, true);
  } finally {
    await preview.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});

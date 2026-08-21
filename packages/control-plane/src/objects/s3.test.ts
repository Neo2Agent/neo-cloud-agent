import assert from "node:assert/strict";
import test from "node:test";
import { createS3ObjectStore, s3ObjectUrl, signS3Request } from "./s3.js";

test("signS3Request produces a scoped SigV4 authorization header", () => {
  const url = new URL("https://s3.us-east-1.amazonaws.com/neo/runs/r1/snapshot.json");
  const headers = signS3Request({
    method: "PUT",
    url,
    body: "{\"ok\":true}\n",
    accessKey: "AKIATEST",
    secretKey: "secret",
    region: "us-east-1",
    now: new Date("2026-08-21T00:00:00.000Z"),
    extraHeaders: { "content-type": "application/json" },
  });
  assert.equal(headers["x-amz-date"], "20260821T000000Z");
  assert.match(headers.authorization ?? "", /^AWS4-HMAC-SHA256 Credential=AKIATEST\/20260821\/us-east-1\/s3\/aws4_request,/);
  assert.match(headers.authorization ?? "", /Signature=[0-9a-f]{64}$/);
  assert.equal(s3ObjectUrl({
    bucket: "neo",
    region: "us-east-1",
    endpoint: "https://s3.us-east-1.amazonaws.com",
    accessKey: "a",
    secretKey: "b",
    prefix: "",
  }, "runs/r1/snapshot.json").href, "https://s3.us-east-1.amazonaws.com/neo/runs/r1/snapshot.json");
});

test("S3 object store put/get uses the injected fetch", async () => {
  const calls: Array<{ method?: string; url: string }> = [];
  const objects = new Map<string, string>();
  const store = createS3ObjectStore(
    {
      bucket: "neo",
      region: "us-east-1",
      endpoint: "https://s3.example.test",
      accessKey: "AKIATEST",
      secretKey: "secret",
      prefix: "",
    },
    async (input, init) => {
      const url = String(input);
      calls.push({ method: init?.method, url });
      if (init?.method === "PUT") {
        objects.set(url, String(init.body ?? ""));
        return new Response(null, { status: 200 });
      }
      if (url.includes("list-type")) {
        return new Response("<ListBucketResult><Key>runs/r1/events.jsonl</Key></ListBucketResult>", { status: 200 });
      }
      const body = objects.get(url);
      return body === undefined ? new Response(null, { status: 404 }) : new Response(body, { status: 200 });
    },
  );
  await store.put("runs/r1/events.jsonl", "{}\n");
  assert.equal(await store.get("runs/r1/events.jsonl"), "{}\n");
  assert.equal(await store.get("missing"), null);
  assert.deepEqual(await store.list("runs/r1/"), ["runs/r1/events.jsonl"]);
  assert.ok(calls.every((call) => call.method === "PUT" || call.method === "GET"));
});

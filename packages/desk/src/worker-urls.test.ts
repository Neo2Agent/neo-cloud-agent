import assert from "node:assert/strict";
import test from "node:test";
import { publicizeWorkerUrls } from "./worker-urls.js";

test("production loopback assignment is rewritten to the Desk public origin", () => {
  assert.deepEqual(
    publicizeWorkerUrls(
      { controlPlaneUrl: "http://127.0.0.1:8080", llmGatewayUrl: "http://127.0.0.1:8081" },
      "http://62.234.211.200",
    ),
    {
      controlPlaneUrl: "http://62.234.211.200",
      llmGatewayUrl: "http://62.234.211.200:8081",
    },
  );
});

test("already-public assignment urls are left alone", () => {
  assert.deepEqual(
    publicizeWorkerUrls(
      { controlPlaneUrl: "http://62.234.211.200", llmGatewayUrl: "http://62.234.211.200:8081" },
      "http://62.234.211.200",
    ),
    {
      controlPlaneUrl: "http://62.234.211.200",
      llmGatewayUrl: "http://62.234.211.200:8081",
    },
  );
});

test("HTTPS public origin keeps the raw gateway on the production IP", () => {
  assert.deepEqual(
    publicizeWorkerUrls(
      { controlPlaneUrl: "http://127.0.0.1:8080", llmGatewayUrl: "http://127.0.0.1:8081" },
      "https://neorun.cloud",
    ),
    {
      controlPlaneUrl: "https://neorun.cloud",
      llmGatewayUrl: "http://62.234.211.200:8081",
    },
  );
});

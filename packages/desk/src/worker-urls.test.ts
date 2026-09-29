import assert from "node:assert/strict";
import test from "node:test";
import { publicizeToolsChannelUrl, publicizeWorkerUrls } from "./worker-urls.js";

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

test("a loopback Remote tools channel is retargeted at the public control plane", () => {
  assert.equal(
    publicizeToolsChannelUrl("http://127.0.0.1:8080/v1/desks/desk_1/tools/run_1", "https://neorun.cloud"),
    "https://neorun.cloud/v1/desks/desk_1/tools/run_1",
  );
});

test("local Desk keeps a loopback tools channel on the local control plane", () => {
  assert.equal(
    publicizeToolsChannelUrl(
      "http://127.0.0.1:8080/v1/desks/desk_1/tools/run_1",
      "http://127.0.0.1:8080",
    ),
    "http://127.0.0.1:8080/v1/desks/desk_1/tools/run_1",
  );
});

test("a direct neo-loop address is not published", () => {
  assert.equal(publicizeToolsChannelUrl("http://127.0.0.1:8082", "https://neorun.cloud"), "http://127.0.0.1:8082");
});

test("an already public tools channel is left alone", () => {
  assert.equal(
    publicizeToolsChannelUrl("https://neorun.cloud/v1/desks/desk_1/tools/run_1", "https://neorun.cloud"),
    "https://neorun.cloud/v1/desks/desk_1/tools/run_1",
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

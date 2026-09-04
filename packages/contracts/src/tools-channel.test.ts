import assert from "node:assert/strict";
import test from "node:test";
import { TOOLS_CHANNEL_VERSION, isToolsChannelFrame } from "./tools-channel.js";

test("isToolsChannelFrame requires v=1 and a type", () => {
  assert.equal(isToolsChannelFrame({ v: TOOLS_CHANNEL_VERSION, type: "ping" }), true);
  assert.equal(isToolsChannelFrame({ v: 2, type: "ping" }), false);
  assert.equal(isToolsChannelFrame({ type: "ping" }), false);
  assert.equal(isToolsChannelFrame(null), false);
});

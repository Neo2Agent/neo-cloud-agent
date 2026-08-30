import assert from "node:assert/strict";
import test from "node:test";
import { INSECURE_MIC_HINT, UNSUPPORTED_MIC_HINT } from "./cloud.js";
import { browserMicReady } from "./pcm.js";

test("browserMicReady allows a page that has getUserMedia", () => {
  const win = {
    isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia: async () => ({}) } },
  } as unknown as Window;
  assert.equal(browserMicReady(win), null);
});

test("browserMicReady explains HTTP pages without mediaDevices", () => {
  const win = {
    isSecureContext: false,
    navigator: {},
  } as unknown as Window;
  assert.equal(browserMicReady(win), INSECURE_MIC_HINT);
});

test("browserMicReady explains a secure page with no mic API", () => {
  const win = {
    isSecureContext: true,
    navigator: {},
  } as unknown as Window;
  assert.equal(browserMicReady(win), UNSUPPORTED_MIC_HINT);
});

import assert from "node:assert/strict";
import test from "node:test";
import { INSECURE_MIC_HINT, UNSUPPORTED_MIC_HINT } from "./cloud.js";
import { browserMicReady, floatTo16Bit, pageAllowsLiveMic, resolveGetUserMedia } from "./pcm.js";

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

test("pageAllowsLiveMic refuses modern getUserMedia on insecure HTTP", () => {
  const win = {
    isSecureContext: false,
    navigator: { mediaDevices: { getUserMedia: async () => ({}) } },
  } as unknown as Window;
  assert.equal(pageAllowsLiveMic(win), false);
  assert.equal(browserMicReady(win), INSECURE_MIC_HINT);
});

test("pageAllowsLiveMic accepts prefixed getUserMedia on HTTP pages", () => {
  const nav = {
    webkitGetUserMedia: (_c: unknown, success: (stream: unknown) => void) => success({}),
  };
  assert.equal(typeof resolveGetUserMedia(nav as never), "function");
  assert.equal(pageAllowsLiveMic({ navigator: nav } as unknown as Window), true);
  assert.equal(
    browserMicReady({ isSecureContext: false, navigator: nav } as unknown as Window),
    null,
  );
});

test("floatTo16Bit resamples and clips", () => {
  const pcm = floatTo16Bit(Float32Array.from([1, -1, 0.5]), 16_000);
  assert.equal(pcm.length, 6);
  const view = new DataView(pcm.buffer);
  assert.equal(view.getInt16(0, true), 0x7fff);
  assert.equal(view.getInt16(2, true), -0x8000);
  const down = floatTo16Bit(Float32Array.from([0.5, 0.5]), 32_000);
  assert.equal(down.length, 2);
});

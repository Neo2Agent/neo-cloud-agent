import assert from "node:assert/strict";
import test from "node:test";
import { peekPendingIngress, rememberPendingIngress, resetPendingIngressForTests, takePendingIngress } from "./pending.js";

test("pending ingress remembers a photo until the next text", () => {
  resetPendingIngressForTests();
  rememberPendingIngress("telegram:1", { kind: "image", label: "图片", image: { mediaType: "image/png", data: "abc" } });
  assert.equal(peekPendingIngress("telegram:1")?.label, "图片");
  const taken = takePendingIngress("telegram:1");
  assert.equal(taken?.image?.data, "abc");
  assert.equal(takePendingIngress("telegram:1"), null);
});

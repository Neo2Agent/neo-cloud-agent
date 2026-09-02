import assert from "node:assert/strict";
import test from "node:test";
import { transcriptUserImageSrc } from "./user-image.js";

test("transcriptUserImageSrc prefers the href and appends the access token", () => {
  assert.equal(
    transcriptUserImageSrc(
      { mediaType: "image/jpeg", data: "", href: "/v1/runs/r1/transcript/images/m1/0" },
      "tok",
    ),
    "/v1/runs/r1/transcript/images/m1/0?access_token=tok",
  );
  assert.equal(
    transcriptUserImageSrc({ mediaType: "image/jpeg", data: "ZmFrZQ" }, ""),
    "data:image/jpeg;base64,ZmFrZQ",
  );
  assert.equal(transcriptUserImageSrc({ mediaType: "image/jpeg", data: "" }, "tok"), "");
});

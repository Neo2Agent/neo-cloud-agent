import assert from "node:assert/strict";
import test from "node:test";
import { formatPrArtifactMarkdown, signArtifactAccess, verifyArtifactAccess } from "./signed.js";

test("signed artifact tokens verify for the same run and name", () => {
  const token = signArtifactAccess("run-1", "shot.png");
  assert.equal(verifyArtifactAccess(token, "run-1", "shot.png"), true);
  assert.equal(verifyArtifactAccess(token, "run-2", "shot.png"), false);
  assert.equal(verifyArtifactAccess(token, "run-1", "other.png"), false);
  assert.equal(verifyArtifactAccess("not-a-token", "run-1", "shot.png"), false);
});

test("PR artifact markdown lists signed links", () => {
  const body = formatPrArtifactMarkdown("run-1", [
    {
      name: "notes.txt",
      url: "/v1/runs/run-1/artifacts/notes.txt",
      contentType: "text/plain",
      sizeBytes: 12,
      createdAt: new Date().toISOString(),
    },
  ]);
  assert.match(body, /## Artifacts/);
  assert.match(body, /notes\.txt/);
  assert.match(body, /token=/);
});

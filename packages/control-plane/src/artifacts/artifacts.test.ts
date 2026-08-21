import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryObjectStore } from "../objects/memory.js";
import { setObjectStoreForTests } from "../objects/store.js";
import { listRunArtifacts, putRunArtifact, readRunArtifact, safeArtifactName } from "./artifacts.js";
import { resetHistory } from "../events/bus.js";

test("putRunArtifact stores bytes and lists them", async () => {
  setObjectStoreForTests(createMemoryObjectStore());
  resetHistory();
  const saved = await putRunArtifact("run_art", {
    name: "notes.txt",
    content: "hello",
    contentType: "text/plain; charset=utf-8",
  });
  assert.equal(saved.name, "notes.txt");
  assert.equal(saved.sizeBytes, 5);
  assert.equal(saved.url, "/v1/runs/run_art/artifacts/notes.txt");
  const listed = await listRunArtifacts("run_art");
  assert.equal(listed.length, 1);
  const file = await readRunArtifact("run_art", "notes.txt");
  assert.equal(file?.body.toString("utf8"), "hello");
  assert.equal(safeArtifactName("../x.png"), "x.png");
  setObjectStoreForTests(null);
  resetHistory();
});

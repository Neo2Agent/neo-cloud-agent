import assert from "node:assert/strict";
import test from "node:test";
import { hasSavedSession } from "./session.js";

test("saved account sessions skip the login overlay on first paint", () => {
  assert.equal(hasSavedSession(""), false);
  assert.equal(hasSavedSession("neo_"), false);
  assert.equal(hasSavedSession("neo_sess_abc"), true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { savedDeskOwnedBy } from "./desk-owner.js";

test("a saved desk that is in this account's list stays", () => {
  assert.equal(savedDeskOwnedBy([{ id: "desk_mine" }, { id: "desk_other" }], "desk_mine"), true);
});

test("a saved desk missing from this account's list is dropped", () => {
  assert.equal(savedDeskOwnedBy([{ id: "desk_mine" }], "desk_foreign"), false);
  assert.equal(savedDeskOwnedBy([], "desk_foreign"), false);
});

test("a failed desk list keeps the saved machine", () => {
  assert.equal(savedDeskOwnedBy(null, "desk_mine"), null);
});

test("an empty saved id does not count as a foreign desk", () => {
  assert.equal(savedDeskOwnedBy([], ""), true);
  assert.equal(savedDeskOwnedBy(null, ""), true);
});

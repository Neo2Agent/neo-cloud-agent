import assert from "node:assert/strict";
import test from "node:test";
import { deskAssignmentAlert } from "./notify-assignment.js";

test("this window starting a worker does not toast", () => {
  assert.equal(
    deskAssignmentAlert({ alreadyLocal: false, startingHere: true, windowFocused: true, requireApproval: false }),
    "silent",
  );
  assert.equal(
    deskAssignmentAlert({ alreadyLocal: true, startingHere: false, windowFocused: false, requireApproval: false }),
    "silent",
  );
});

test("a focused Desk does not toast when the user just sent", () => {
  assert.equal(
    deskAssignmentAlert({ alreadyLocal: false, startingHere: false, windowFocused: true, requireApproval: false }),
    "silent",
  );
});

test("background remote work still notifies, or asks if approval is on", () => {
  assert.equal(
    deskAssignmentAlert({ alreadyLocal: false, startingHere: false, windowFocused: false, requireApproval: false }),
    "notify",
  );
  assert.equal(
    deskAssignmentAlert({ alreadyLocal: false, startingHere: false, windowFocused: true, requireApproval: true }),
    "approve",
  );
});

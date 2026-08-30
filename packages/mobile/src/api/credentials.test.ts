import assert from "node:assert/strict";
import test from "node:test";
import { resetSharedWebCredentials, sharedWebCredentials, webCredentials } from "./credentials.js";
import { nextEnvId } from "./shell.js";

test("shared web credentials keep one identity across default-arg evaluations", () => {
  resetSharedWebCredentials();
  assert.equal(sharedWebCredentials(), sharedWebCredentials());
  assert.notEqual(webCredentials(), webCredentials());
});

test("nextEnvId keeps the current environment so a first pick does not retrigger a refresh", () => {
  assert.equal(nextEnvId("", [{ id: "env-1" }, { id: "env-2" }]), "env-1");
  assert.equal(nextEnvId("env-2", [{ id: "env-1" }]), "env-2");
  assert.equal(nextEnvId("", []), "");
});

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-devices-"));

const { deleteDevice, isExpoPushToken, listDevices, listStoredDevices, resetDevicesForTests, upsertDevice } =
  await import("./store.js");

test("upsertDevice keeps the push token off the public record", () => {
  resetDevicesForTests();
  const created = upsertDevice(
    { platform: "ios", pushToken: "ExponentPushToken[abc]" },
    { userId: "user_ada", orgId: "org_local" },
  );
  assert.match(created.id, /^dev_/);
  assert.equal(created.platform, "ios");
  assert.equal(created.pushToken, undefined);
  assert.equal(listDevices("user_ada").length, 1);
  assert.equal(listStoredDevices("user_ada")[0]?.pushToken, "ExponentPushToken[abc]");
  const again = upsertDevice(
    { platform: "ios", pushToken: "ExponentPushToken[abc]" },
    { userId: "user_ada", orgId: "org_local" },
  );
  assert.equal(again.id, created.id);
  assert.equal(listDevices("user_ada").length, 1);
  assert.equal(isExpoPushToken("ExponentPushToken[abc]"), true);
  assert.equal(isExpoPushToken("nope"), false);
  assert.equal(deleteDevice(created.id, "user_ada"), true);
  assert.equal(listDevices("user_ada").length, 0);
});

test("upsertDevice rejects a bad platform", () => {
  resetDevicesForTests();
  assert.throws(
    () =>
      upsertDevice(
        { platform: "desktop" as "ios", pushToken: "ExponentPushToken[x]" },
        { userId: "user_ada", orgId: "org_local" },
      ),
    /platform/,
  );
});

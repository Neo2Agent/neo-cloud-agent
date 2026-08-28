import assert from "node:assert/strict";
import test from "node:test";
import { isDeskPackaged } from "./ports.js";
import { deskWorkerLaunch } from "./spawn.js";

test("packaged Desk launches the bundled worker, not the repo tsx entry", () => {
  assert.equal(isDeskPackaged({}), false);
  assert.equal(isDeskPackaged({ NEO_DESK_PACKAGED: "1" }), true);
  const launch = deskWorkerLaunch({
    execPath: "/app/Neo Desk",
    env: { NEO_DESK_PACKAGED: "1", NEO_DESK_RESOURCES: "/app/Resources" },
  });
  assert.equal(launch.command, "/app/Neo Desk");
  assert.deepEqual(launch.args, ["/app/Resources/worker.cjs"]);
  assert.equal(launch.cwd, "/app/Resources");
});

test("dev Desk still starts the worker through tsx in the repo", () => {
  const launch = deskWorkerLaunch({ execPath: "/usr/bin/node", env: {} });
  assert.match(launch.args[0] ?? "", /tsx\/dist\/cli\.mjs$/);
  assert.match(launch.args[1] ?? "", /packages\/worker\/src\/index\.ts$/);
});

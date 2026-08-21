import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { main } from "./index.js";
import type { CliIo } from "./io.js";

function captureIo(): { io: CliIo; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      out: { write: (chunk) => { out += chunk; } },
      err: { write: (chunk) => { err += chunk; } },
      stdin: Readable.from([]),
      env: {},
      cwd: "/tmp",
      now: () => Date.now(),
      isStdoutTty: false,
      isStdinTty: true,
      homedir: () => "/tmp",
    },
    out: () => out,
    err: () => err,
  };
}

test("help and version do not hit the network", async () => {
  const help = captureIo();
  assert.equal(await main(["--help"], help.io), 0);
  assert.match(help.out(), /neo — Neo Cloud Agent/);

  const version = captureIo();
  assert.equal(await main(["--version"], version.io), 0);
  assert.match(version.out(), /0\.1\.0/);
});

test("run without a repo is a usage error", async () => {
  const sink = captureIo();
  assert.equal(await main(["run", "hello"], sink.io), 2);
  assert.match(sink.err(), /need --repo/);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("CJS bundle loads bundled plugins when import.meta.url is empty", () => {
  const repo = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const outfile = path.join(mkdtempSync(path.join(tmpdir(), "bundled-plugins-cjs-")), "bundled-plugins.cjs");
  const esbuild = path.join(repo, "packages/desk/node_modules/esbuild/bin/esbuild");
  const packed = spawnSync(
    esbuild,
    [
      path.join(repo, "packages/contracts/src/bundled-plugins.ts"),
      "--bundle",
      "--platform=node",
      "--format=cjs",
      `--outfile=${outfile}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const loaded = createRequire(outfile)(outfile) as { BUNDLED_PLUGINS: Array<{ slug: string }> };
  assert.deepEqual(
    loaded.BUNDLED_PLUGINS.map((item) => item.slug),
    ["pr-review", "release-notes", "repo-scout", "incident-brief"],
  );
});

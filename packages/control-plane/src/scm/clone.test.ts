import assert from "node:assert/strict";
import { cp } from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { materializeDiskImage, materializeSnapshot, setTryReflinkForTests, tryReflinkPath } from "./clone.js";

test.afterEach(() => {
  setTryReflinkForTests();
});

function snapshotFixture(): string {
  const src = mkdtempSync(path.join(tmpdir(), "neo-snap-src-"));
  mkdirSync(path.join(src, "node_modules", "pkg"), { recursive: true });
  writeFileSync(path.join(src, "hello.txt"), "from snapshot\n");
  writeFileSync(path.join(src, "node_modules", "pkg", "index.js"), "ok\n");
  return src;
}

test("tryReflinkPath reports unsupported on overlayfs hosts", async () => {
  const src = snapshotFixture();
  const dest = path.join(mkdtempSync(path.join(tmpdir(), "neo-snap-dest-")), "ws");
  const ok = await tryReflinkPath(src, dest);
  if (ok) {
    assert.equal(readFileSync(path.join(dest, "hello.txt"), "utf8"), "from snapshot\n");
    return;
  }
  assert.equal(existsSync(dest), false);
});

test("materializeSnapshot falls back to a full tree copy when reflink fails", async () => {
  setTryReflinkForTests(async () => false);
  const src = snapshotFixture();
  const dest = path.join(mkdtempSync(path.join(tmpdir(), "neo-clone-copy-")), "ws");
  const result = await materializeSnapshot(src, dest);
  assert.equal(result.method, "copy");
  assert.equal(result.kind, "workspace");
  assert.equal(result.dest, dest);
  assert.equal(readFileSync(path.join(dest, "hello.txt"), "utf8"), "from snapshot\n");
  assert.equal(readFileSync(path.join(dest, "node_modules", "pkg", "index.js"), "utf8"), "ok\n");
});

test("materializeSnapshot uses an injected reflink", async () => {
  setTryReflinkForTests(async (src, dest) => {
    await cp(src, dest, { recursive: true });
    return true;
  });
  const src = snapshotFixture();
  const dest = path.join(mkdtempSync(path.join(tmpdir(), "neo-clone-ref-")), "ws");
  const result = await materializeSnapshot(src, dest);
  assert.equal(result.method, "reflink");
  assert.equal(readFileSync(path.join(dest, "hello.txt"), "utf8"), "from snapshot\n");
  assert.equal(readFileSync(path.join(dest, "node_modules", "pkg", "index.js"), "utf8"), "ok\n");
});

test("materializeDiskImage shares the source when reflink is unsupported", async () => {
  setTryReflinkForTests(async () => false);
  const dir = mkdtempSync(path.join(tmpdir(), "neo-disk-"));
  const src = path.join(dir, "rootfs.ext4");
  const dest = path.join(dir, "run", "rootfs.ext4");
  writeFileSync(src, "image-bytes");
  const result = await materializeDiskImage(src, dest);
  assert.deepEqual(result, { method: "shared", dest: src, kind: "rootfs" });
  assert.equal(existsSync(dest), false);
});

test("materializeDiskImage writes a CoW dest when reflink succeeds", async () => {
  setTryReflinkForTests(async (src, dest) => {
    await cp(src, dest);
    return true;
  });
  const dir = mkdtempSync(path.join(tmpdir(), "neo-disk-ref-"));
  const src = path.join(dir, "rootfs.ext4");
  const dest = path.join(dir, "run", "rootfs.ext4");
  writeFileSync(src, "image-bytes");
  const result = await materializeDiskImage(src, dest);
  assert.deepEqual(result, { method: "reflink", dest, kind: "rootfs" });
  assert.equal(readFileSync(dest, "utf8"), "image-bytes");
});

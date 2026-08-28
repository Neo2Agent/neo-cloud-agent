import assert from "node:assert/strict";
import test from "node:test";
import { isHomeOrFilesystemRoot, isOverlyBroadFolder } from "./folder-auth.js";

test("home and the filesystem root are refused", () => {
  assert.equal(isHomeOrFilesystemRoot("/", "/home/me"), true);
  assert.equal(isHomeOrFilesystemRoot("/home/me", "/home/me"), true);
  assert.equal(isHomeOrFilesystemRoot("/home/me/", "/home/me"), true);
  assert.equal(isHomeOrFilesystemRoot("C:\\", "C:\\Users\\me"), true);
  assert.equal(isHomeOrFilesystemRoot("C:\\Users\\me", "C:\\Users\\me"), true);
  assert.equal(isHomeOrFilesystemRoot("/home/me/proj", "/home/me"), false);
  assert.equal(isHomeOrFilesystemRoot("C:\\Users\\me\\proj", "C:\\Users\\me"), false);
});

test("overly-broad folders are the parent itself, not a project inside it", () => {
  assert.equal(isOverlyBroadFolder("/tmp"), true);
  assert.equal(isOverlyBroadFolder("/var/tmp"), true);
  assert.equal(isOverlyBroadFolder("/Users"), true);
  assert.equal(isOverlyBroadFolder("/home"), true);
  assert.equal(isOverlyBroadFolder("/opt"), true);
  assert.equal(isOverlyBroadFolder("C:\\Users"), true);
  assert.equal(isOverlyBroadFolder("/Users/me/proj"), false);
  assert.equal(isOverlyBroadFolder("/tmp/build"), false);
  assert.equal(isOverlyBroadFolder("/home/me/src"), false);
});

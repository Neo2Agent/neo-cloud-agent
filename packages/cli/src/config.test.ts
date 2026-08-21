import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearStoredCredentials,
  loadStoredCredentials,
  resolveApiToken,
  resolveApiUrl,
  saveStoredCredentials,
} from "./config.js";
import type { CliIo } from "./io.js";

function testIo(env: NodeJS.ProcessEnv, dir: string): CliIo {
  return {
    out: { write() {} },
    err: { write() {} },
    stdin: process.stdin,
    env,
    cwd: dir,
    now: () => Date.now(),
    isStdoutTty: false,
    isStdinTty: true,
    homedir: () => dir,
  };
}

test("resolveApiUrl prefers flag then env then default", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-cli-config-"));
  const io = testIo({ NEO_API_URL: "http://env:8080" }, dir);
  assert.equal(resolveApiUrl(io, "http://flag:9/"), "http://flag:9");
  assert.equal(resolveApiUrl(io), "http://env:8080");
  assert.equal(resolveApiUrl(testIo({}, dir)), "http://127.0.0.1:8080");
});

test("credentials are stored 0600 and env overrides the file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-cli-creds-"));
  const io = testIo({ NEO_CONFIG_DIR: dir }, dir);
  saveStoredCredentials(io, { token: "neo_sess_file" });
  const file = path.join(dir, "credentials.json");
  assert.equal((statSync(file).mode & 0o777), 0o600);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).token, "neo_sess_file");
  assert.equal(loadStoredCredentials(io).token, "neo_sess_file");
  assert.equal(resolveApiToken(io), "neo_sess_file");
  assert.equal(resolveApiToken(testIo({ NEO_CONFIG_DIR: dir, NEO_API_KEY: "from-env" }, dir)), "from-env");
  clearStoredCredentials(io);
  assert.equal(loadStoredCredentials(io).token, undefined);
});

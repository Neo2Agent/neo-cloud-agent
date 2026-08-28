import assert from "node:assert/strict";
import test from "node:test";
import {
  admitLocalRun,
  DEFAULT_MAX_LOCAL_RUNS,
  MAX_LOCAL_RUNS_CEILING,
  normalizeMaxLocalRuns,
  type ActiveLocalRun,
} from "./admission.js";

const limit = DEFAULT_MAX_LOCAL_RUNS;

function active(...entries: Array<[string, string]>): ActiveLocalRun[] {
  return entries.map(([runId, folder]) => ({ runId, folder }));
}

test("unrelated folders run at the same time", () => {
  const decision = admitLocalRun({
    runId: "run-b",
    folder: "/home/me/api",
    active: active(["run-a", "/home/me/web"]),
    limit,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.warning, undefined);
});

test("a second run in one folder is allowed, with a warning", () => {
  const decision = admitLocalRun({
    runId: "run-b",
    folder: "/home/me/web",
    active: active(["run-a", "/home/me/web"]),
    limit,
  });
  assert.equal(decision.ok, true);
  assert.match(decision.ok ? (decision.warning ?? "") : "", /同一个文件夹/);
});

test("a trailing separator is still the same folder", () => {
  const decision = admitLocalRun({
    runId: "run-b",
    folder: "/home/me/web/",
    active: active(["run-a", "/home/me/web"]),
    limit,
  });
  assert.equal(decision.ok && Boolean(decision.warning), true);
});

test("the machine limit is the only hard stop", () => {
  const decision = admitLocalRun({
    runId: "run-e",
    folder: "/home/me/e",
    active: active(["run-a", "/a"], ["run-b", "/b"], ["run-c", "/c"], ["run-d", "/d"]),
    limit: 4,
  });
  assert.equal(decision.ok, false);
  assert.match(decision.ok ? "" : decision.reason, /最多跑 4 条/);
});

test("a run already counted does not block itself", () => {
  const busy = active(["run-a", "/a"], ["run-b", "/b"], ["run-c", "/c"], ["run-d", "/d"]);
  assert.equal(admitLocalRun({ runId: "run-d", folder: "/d", active: busy, limit: 4 }).ok, true);
});

test("a start still preparing its workspace counts against the limit", () => {
  // The host reserves the slot before awaiting, so an entry with no folder yet
  // must not look like free capacity.
  const decision = admitLocalRun({
    runId: "run-b",
    folder: "/home/me/api",
    active: active(["run-a", ""]),
    limit: 1,
  });
  assert.equal(decision.ok, false);
});

test("the limit is clamped rather than trusted", () => {
  assert.equal(normalizeMaxLocalRuns(undefined), DEFAULT_MAX_LOCAL_RUNS);
  assert.equal(normalizeMaxLocalRuns(0), DEFAULT_MAX_LOCAL_RUNS);
  assert.equal(normalizeMaxLocalRuns(-3), DEFAULT_MAX_LOCAL_RUNS);
  assert.equal(normalizeMaxLocalRuns("4" as unknown), DEFAULT_MAX_LOCAL_RUNS);
  assert.equal(normalizeMaxLocalRuns(2), 2);
  assert.equal(normalizeMaxLocalRuns(2.7), 2);
  assert.equal(normalizeMaxLocalRuns(9_999), MAX_LOCAL_RUNS_CEILING);
  // A limit of 1 keeps the old one-at-a-time behaviour available.
  assert.equal(
    admitLocalRun({ runId: "b", folder: "/b", active: active(["a", "/a"]), limit: 1 }).ok,
    false,
  );
});

test("on macOS and Windows two spellings are the same folder", () => {
  const warningWhen = (caseInsensitivePaths: boolean) => {
    const decision = admitLocalRun({
      runId: "run-b",
      folder: "/Users/me/Web",
      active: active(["run-a", "/Users/me/web"]),
      limit,
      caseInsensitivePaths,
    });
    return decision.ok ? (decision.warning ?? "") : "";
  };
  // On Linux those are two different directories, so there is nothing to warn about.
  assert.equal(warningWhen(false), "");
  assert.match(warningWhen(true), /同一个文件夹/);
});

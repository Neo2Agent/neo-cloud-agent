import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseExtractedMemories } from "@neo-cloud-agent/contracts";
import { createFileAccountStore } from "../accounts/file.js";
import { setAccountStore } from "../accounts/store.js";
import { setMem0FetchForTests } from "./client.js";
import { extractUserMemories, setExtractCompleteForTests } from "./extract.js";

test("extract fixture keeps pnpm/style/habit and drops family or idle-slot facts", async () => {
  const previousDir = process.env.RUNS_DIR;
  const previousUrl = process.env.MEM0_URL;
  const previousKey = process.env.MEM0_API_KEY;
  process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-mem-extract-"));
  process.env.MEM0_URL = "http://mem0.test";
  process.env.MEM0_API_KEY = "m0sk_test";
  setAccountStore(createFileAccountStore(process.env.RUNS_DIR), "file");
  const added: string[] = [];
  setMem0FetchForTests(async (url, init) => {
    if (init?.method === "POST" && String(url).endsWith("/memories")) {
      const body = JSON.parse(String(init.body ?? "{}")) as { text?: string };
      added.push(body.text ?? "");
      return new Response(JSON.stringify({ results: [{ id: `m${added.length}`, memory: body.text }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  });
  setExtractCompleteForTests(async () =>
    JSON.stringify([
      { text: "通常用 pnpm", kind: "coding" },
      { text: "倾向最小 diff", kind: "style" },
      { text: "先结论少复述", kind: "habit" },
      { text: "家人最近很累", kind: "habit" },
      { text: "昨天定了 idle 槽写回", kind: "coding" },
    ]),
  );
  try {
    const saved = await extractUserMemories({
      userId: "user_extract",
      runId: "run_extract",
      messages: [
        { role: "user", text: "家人最近很累，先用 pnpm，另外昨天定了 idle 槽写回" },
        { role: "assistant", text: "好，我按 pnpm 来。" },
      ],
    });
    assert.deepEqual(
      saved.map((item) => item.text),
      ["通常用 pnpm", "倾向最小 diff", "先结论少复述"],
    );
    assert.deepEqual(added, ["通常用 pnpm", "倾向最小 diff", "先结论少复述"]);
    assert.equal(parseExtractedMemories(JSON.stringify([{ text: "家人最近很累", kind: "habit" }])).length, 0);
  } finally {
    setExtractCompleteForTests(null);
    setMem0FetchForTests(null);
    setAccountStore(null, "file");
    if (previousDir === undefined) delete process.env.RUNS_DIR;
    else process.env.RUNS_DIR = previousDir;
    if (previousUrl === undefined) delete process.env.MEM0_URL;
    else process.env.MEM0_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MEM0_API_KEY;
    else process.env.MEM0_API_KEY = previousKey;
  }
});

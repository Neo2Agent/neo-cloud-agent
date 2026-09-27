/**
 * Remote Control follow: screenshot the transcript and assert the mock reply
 * appears once. Send-success is not enough.
 *
 * Requires :8080, :5173, Desk Electron on :9223, neo-loop healthy.
 */
import { chromium, type Page } from "../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const MOCK =
  "Mock gateway response. Save a DeepSeek or OpenAI API key on the chat page, or set DEEPSEEK_API_KEY / OPENAI_API_KEY.";
const FIRST = "RC-PROBE-inline-remote-pingingonly";
const FOLLOW = "RC-PROBE-followfromwebtokenonly";
const ARTIFACT_DIR = "/opt/cursor/artifacts";

export function countNeedle(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let from = 0;
  while (true) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) {
      return count;
    }
    count += 1;
    from = at + needle.length;
  }
}

async function login(page: Page) {
  const gate = page.locator("#auth-gate:not([hidden]) #auth-form");
  if ((await gate.count()) === 0) {
    return;
  }
  await page.evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const user = document.querySelector("#auth-email");
    const pass = document.querySelector("#auth-password");
    if (!user || !pass || !set) return;
    set.call(user, "admin");
    user.dispatchEvent(new Event("input", { bubbles: true }));
    set.call(pass, "123456");
    pass.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await page.locator("#auth-submit").click();
  await page.waitForTimeout(1500);
}

async function shot(page: Page, name: string) {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const path = `${ARTIFACT_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}

type TranscriptDump = {
  href: string;
  assistantTexts: string[];
  setupTexts: string[];
  userTexts: string[];
  bodyText: string;
};

async function dumpTranscript(page: Page): Promise<TranscriptDump> {
  return page.evaluate(`(() => {
    const bubbles = [...document.querySelectorAll(".bubble")];
    const textOf = (node) => (node.innerText || "").replace(/\\s+/g, " ").trim();
    return {
      href: location.href,
      assistantTexts: bubbles.filter((item) => item.classList.contains("assistant")).map(textOf),
      setupTexts: bubbles.filter((item) => item.classList.contains("setup")).map(textOf),
      userTexts: bubbles.filter((item) => item.classList.contains("user")).map(textOf),
      bodyText: (document.querySelector(".transcript")?.innerText || document.body.innerText || "").replace(/\\s+/g, " ").trim(),
    };
  })()`) as Promise<TranscriptDump>;
}

function assertUniqueMock(dump: TranscriptDump, where: string): void {
  const joined = dump.assistantTexts.join("\n");
  const inAssistants = countNeedle(joined, MOCK);
  const inBody = countNeedle(dump.bodyText, MOCK);
  if (inAssistants !== 1) {
    throw new Error(`${where}: assistant mock count ${inAssistants} (want 1). assistants=${JSON.stringify(dump.assistantTexts)}`);
  }
  if (inBody !== 1) {
    throw new Error(`${where}: page mock count ${inBody} (want 1). body=${dump.bodyText.slice(0, 800)}`);
  }
  if (dump.assistantTexts.some((text) => countNeedle(text, MOCK) > 1)) {
    throw new Error(`${where}: one bubble contains the mock twice. assistants=${JSON.stringify(dump.assistantTexts)}`);
  }
}

const chrome = await chromium.launch({
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const web = await chrome.newPage({ viewport: { width: 1280, height: 800 } });
await web.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await login(web);

const electron = await chromium.connectOverCDP("http://127.0.0.1:9223");
const context = electron.contexts()[0];
const desk = context?.pages().find((item) => item.url().includes("5173")) ?? context?.pages()[0];
if (!desk) {
  throw new Error("no electron page");
}
await desk.reload({ waitUntil: "domcontentloaded" });
await desk.waitForTimeout(1200);
await login(desk);
await desk.evaluate(`location.hash = "#/"`);
await desk.waitForTimeout(400);

const created = (await desk.evaluate(`(async () => {
  const neo = window.neoDesk;
  if (!neo?.startRun || !neo.getToken) {
    return { error: "stale desk preload" };
  }
  const token = await neo.getToken();
  const prefs = await neo.getPrefs?.();
  const target = await neo.getTarget();
  const folder = target.folder || "";
  if (!folder) {
    return { error: "desk has no folder; pick one in composer first" };
  }
  const deskId = prefs?.deskId || target.deskId || "";
  if (!deskId) {
    return { error: "desk is not registered" };
  }
  const health = await fetch("/v1/health").then((res) => res.json()).catch(() => ({}));
  if (health?.neoLoop?.available === false) {
    return { error: "neo-loop unavailable" };
  }
  const res = await fetch("/v1/runs?client=desk", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify({
      prompt: ${JSON.stringify(FIRST)},
      source: "desk",
      start: "inline",
      kernel: "agentscope",
      repoUrls: [folder],
      skipRepoDefaults: false,
      target: { loop: "cloud", tools: "desk", deskId, remoteControl: true },
    }),
  });
  const body = await res.json();
  if (!res.ok || body.error) {
    return { error: body.error || ("create " + res.status), body };
  }
  const assignment = body.assignment;
  if (!assignment) {
    return { error: "create response missing assignment", runId: body.id };
  }
  const started = await neo.startRun(assignment, folder);
  return { runId: body.id, started, folder, deskId };
})()`)) as { error?: string; runId?: string; started?: boolean };

if (created.error || !created.runId) {
  writeFileSync(`${ARTIFACT_DIR}/rc-follow-reply.json`, JSON.stringify({ created }, null, 2));
  throw new Error(created.error || "create RC run failed");
}

await desk.evaluate(`location.hash = "#/runs/${created.runId}"`);
await desk.waitForTimeout(800);
await shot(desk, "rc-follow-desk-after-create");

await web.goto(`http://127.0.0.1:5173/#/runs/${created.runId}`, { waitUntil: "domcontentloaded" });
await login(web);
await web.waitForTimeout(800);
await web.locator("textarea[name=prompt]").fill(FOLLOW);
await web.locator("#send").click();
await web.waitForTimeout(2000);

const deadline = Date.now() + 45_000;
let dump: TranscriptDump | null = null;
while (Date.now() < deadline) {
  dump = await dumpTranscript(web);
  if (dump.bodyText.includes(MOCK)) {
    break;
  }
  await web.waitForTimeout(1000);
}
if (!dump) {
  throw new Error("no transcript dump");
}

const webShot = await shot(web, "rc-follow-web-reply");
const deskShot = await shot(desk, "rc-follow-desk-reply");
const deskDump = await dumpTranscript(desk);

const report = {
  created,
  web: dump,
  desk: deskDump,
  webShot,
  deskShot,
  mockOnWeb: countNeedle(dump.bodyText, MOCK),
  mockOnDesk: countNeedle(deskDump.bodyText, MOCK),
};
writeFileSync(`${ARTIFACT_DIR}/rc-follow-reply.json`, JSON.stringify(report, null, 2));

assertUniqueMock(dump, "web");
assertUniqueMock(deskDump, "desk");
if (!dump.userTexts.some((text) => text.includes(FOLLOW)) && !dump.bodyText.includes(FOLLOW)) {
  throw new Error("web follow-up text missing from transcript");
}

await chrome.close();
console.log(JSON.stringify({ ok: true, runId: created.runId, webShot, deskShot, mockOnWeb: 1 }, null, 2));
process.exit(0);

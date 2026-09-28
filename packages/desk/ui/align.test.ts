import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "styles.css"), "utf8");
const tokens = readFileSync(path.join(here, "../../ui/src/tokens.css"), "utf8");

test("desk vite does not prebundle the shared ui barrel", () => {
  const vite = readFileSync(path.join(here, "vite.config.ts"), "utf8");
  assert.match(vite, /exclude:\s*\[\s*"@neo-cloud-agent\/ui"\s*\]/);
});

test("desk chrome imports the shared Web monochrome tokens", () => {
  assert.match(css, /@import "@neo-cloud-agent\/ui\/tokens\.css"/);
  assert.match(css, /@import "@neo-cloud-agent\/ui\/git-panel\.css"/);
  assert.match(css, /font-family:\s*var\(--font-sans\)/);
  assert.doesNotMatch(css, /--accent:\s*#19c8b9/);
  assert.doesNotMatch(css, /#794f27/);
  assert.match(tokens, /--bg:\s*#f4f4f5/);
});

test("desk composer is the Cursor / Web box: + pickers left, circular send", () => {
  assert.match(css, /\.composer-box/);
  assert.match(css, /\.composer-pickers\s*\{/);
  assert.match(css, /\.composer-attach\s*\{/);
  assert.match(css, /\.composer-queue\s*\{/);
  assert.match(css, /\.send-btn\s*\{[^}]*border-radius:\s*50%/);
  assert.match(css, /@import "@neo-cloud-agent\/ui\/context-usage\.css"/);
});

test("desk chat is a reading column; empty Files does not steal it", () => {
  const transcript = readFileSync(path.join(here, "chat/transcript.tsx"), "utf8");
  const app = readFileSync(path.join(here, "App.tsx"), "utf8");
  const split = readFileSync(path.join(here, "split.ts"), "utf8");
  const panel = readFileSync(path.join(here, "../src/panel-open.ts"), "utf8");
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*6px\s*minmax\(260px,\s*min\(var\(--panel-w\),\s*36%\)\)/);
  assert.match(css, /\.context-item span/);
  assert.match(split, /PANEL_W_DEFAULT = 360/);
  assert.match(panel, /shouldRestoreDeskPanel/);
  assert.match(app, /shouldRestoreDeskPanel/);
  assert.doesNotMatch(transcript, /<Avatar /);
  assert.doesNotMatch(transcript, /userAvatar/);
});

test("desk chrome copies Cursor Agents Window density, not Island candy", () => {
  const app = readFileSync(path.join(here, "App.tsx"), "utf8");
  const rail = readFileSync(path.join(here, "chat/RailSessions.tsx"), "utf8");
  const meta = readFileSync(path.join(here, "chat/LocalRunMeta.tsx"), "utf8");
  const panel = readFileSync(path.join(here, "SidePanel.tsx"), "utf8");
  assert.doesNotMatch(css, /#3dd4c6/);
  assert.doesNotMatch(css, /#ffcc00/);
  assert.doesNotMatch(css, /#0a7a72/);
  assert.doesNotMatch(css, /rail-more-pop/);
  assert.doesNotMatch(css, /\.wb-home/);
  assert.doesNotMatch(css, /\.wb-tile/);
  assert.match(css, /\.rail-count/);
  assert.match(css, /\.rail-custom/);
  assert.match(css, /\.local-meta-pill/);
  assert.match(css, /\.login-field/);
  assert.match(css, /\.chat-bubble\.user\s*\{[^}]*border:\s*0/);
  assert.match(css, /\.rail-nav \.rail-new-chat\s*\{[^}]*border-radius:\s*8px/);
  assert.match(css, /\.settings-card\s*\{[^}]*border-radius:\s*8px/);
  assert.match(app, /className="rail-new-chat"/);
  assert.match(app, /className="rail-custom"/);
  assert.match(app, /个性化/);
  assert.match(app, /打开侧栏/);
  assert.doesNotMatch(app, /Island/);
  assert.doesNotMatch(app, /rail-more-wrap/);
  assert.doesNotMatch(app, /IconGit/);
  assert.doesNotMatch(app, /IconArtifacts/);
  assert.match(rail, /rail-count/);
  assert.doesNotMatch(rail, /IslandTag/);
  assert.match(meta, /local-meta-pill/);
  assert.doesNotMatch(meta, /就绪/);
  assert.match(panel, /@neo-cloud-agent\/ui\/inspector-tabs/);
  assert.match(panel, /inspectorTabs/);
  assert.match(panel, /aria-label="对话侧栏"/);
  assert.match(panel, /产物/);
  assert.match(panel, /发送任务后可以查看 Git。/);
  assert.doesNotMatch(panel, /Changes/);
  assert.doesNotMatch(panel, /wb-tab-label">Files</);
  assert.match(panel, /resolveSidePanelPage/);
  assert.match(panel, /file-split/);
  assert.match(panel, /term-card-head/);
  assert.match(panel, /发送任务后可以浏览工作区文件。/);
  assert.doesNotMatch(panel, /setRailOpen/);
  assert.doesNotMatch(panel, /wb-rail/);
  assert.doesNotMatch(panel, /wb-home/);
  assert.doesNotMatch(panel, /wb-tile/);
  assert.doesNotMatch(panel, /Island/);
});

test("desk reading type matches Web 13px so a line holds the same words", () => {
  assert.match(css, /\.chat-feed,\s*\n\.feed\.chat-feed\s*\{[^}]*font-size:\s*13px/);
  assert.match(css, /\.chat-bubble\s*\{[^}]*font-size:\s*13px/);
  assert.match(css, /\.assistant-text\s*\{[^}]*font-size:\s*13px/);
  assert.match(css, /\.assistant-text\s*\{[^}]*line-height:\s*1\.55/);
  assert.match(css, /\.composer textarea\s*\{[^}]*font-size:\s*13px/);
  assert.match(css, /\.chat-title\s*\{[^}]*font-size:\s*12px/);
  assert.match(css, /\.inspector-tabs button\[role="tab"\]\s*\{[^}]*font-size:\s*13px/);
  assert.match(css, /\.workspace-files\s*\{[^}]*grid-template-columns:\s*220px/);
  assert.match(css, /\.term-card-head > summary\s*\{[^}]*font-size:\s*13px/);
});

test("desk expert picker sits in the context bar like Web", () => {
  const pages = readFileSync(path.join(here, "pages.tsx"), "utf8");
  const app = readFileSync(path.join(here, "App.tsx"), "utf8");
  assert.match(pages, /className="expert-pick context-expert"/);
  assert.match(pages, /onExpert\?: \(value: string\) => void;/);
  assert.doesNotMatch(pages, /experts,\s*teams,\s*expertValue/);
  assert.match(app, /className=\{current \? "composer-follow" : "home-composer"\}/);
  assert.match(app, /<ContextBar/);
});

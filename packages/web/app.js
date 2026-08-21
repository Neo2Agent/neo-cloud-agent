const transcriptEl = document.getElementById("transcript");
const runListEl = document.getElementById("run-list");
const promptEl = document.getElementById("prompt");
const repoEl = document.getElementById("repo");
const statusEl = document.getElementById("status");
const abortEl = document.getElementById("abort");
const openPrEl = document.getElementById("open-pr");
const prLinkEl = document.getElementById("pr-link");
const healthEl = document.getElementById("health");
const runTitleEl = document.getElementById("run-title");
const runLabelEl = document.getElementById("run-label");

const state = {
  runId: null,
  runs: [],
  events: new Map(),
  source: null,
  assistant: null,
  lastEventId: null,
  healthText: "检测服务…",
};

const STATUS_LABELS = {
  idle: "就绪",
  NOT_YET_STARTED: "未开始",
  PROVISIONING: "准备中",
  INSTALLING: "安装中",
  RUNNING: "运行中",
  IDLE: "空闲",
  WAITING_FOR_BACKGROUND_WORK: "后台任务",
  ERROR: "出错",
  ARCHIVED: "已归档",
  EXPIRED: "已过期",
};

function shortId(id) {
  return id.slice(0, 8);
}

function preview(text) {
  return (text || "未命名任务").replace(/\s+/g, " ").slice(0, 42);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(value) {
  statusEl.dataset.state = value;
  statusEl.textContent = STATUS_LABELS[value] ?? value;
  abortEl.hidden = value !== "RUNNING" && value !== "PROVISIONING" && value !== "INSTALLING";
}

function showPullRequest(run) {
  const pr = run?.pullRequests?.[0];
  if (pr?.url) {
    prLinkEl.hidden = false;
    prLinkEl.href = pr.url;
    prLinkEl.textContent = pr.draft ? "草稿 PR" : "PR";
    openPrEl.hidden = true;
    return;
  }
  prLinkEl.hidden = true;
  prLinkEl.removeAttribute("href");
  openPrEl.hidden = !state.runId;
}

function emptyState() {
  transcriptEl.innerHTML = `
    <div class="empty">
      <h2>从一条任务开始</h2>
      <p>仓库填 <code>fixtures/toy-repo</code>，让 Agent 加 README 并跑 <code>sh test.sh</code>。第一条消息会创建 Run，后续消息作为跟进。多个标签或设备打开同一条 Run，会订阅控制面同一条事件流。</p>
    </div>
  `;
}

function renderRuns() {
  const items = [...state.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  runListEl.innerHTML = items
    .map(
      (run) => `
      <button class="run-item${run.id === state.runId ? " active" : ""}" data-id="${escapeHtml(run.id)}" type="button">
        <strong>${escapeHtml(preview(run.prompt))}</strong>
        <small>${escapeHtml(STATUS_LABELS[run.status] ?? run.status)} · ${escapeHtml(shortId(run.id))}</small>
      </button>
    `,
    )
    .join("");
}

function addBubble(role, text, id) {
  const empty = transcriptEl.querySelector(".empty");
  if (empty) empty.remove();
  const node = document.createElement("article");
  node.className = `bubble ${role}`;
  node.dataset.id = id;
  node.innerHTML = `<span class="who">${role === "user" ? "你" : "Agent"}</span><div class="body"></div>`;
  node.querySelector(".body").textContent = text;
  transcriptEl.appendChild(node);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return node;
}

function ensureAssistant() {
  if (state.assistant && document.body.contains(state.assistant)) {
    return state.assistant;
  }
  state.assistant = addBubble("assistant", "", `assistant-${Date.now()}`);
  return state.assistant;
}

function addSetupLine(event) {
  const empty = transcriptEl.querySelector(".empty");
  if (empty) empty.remove();
  const line = document.createElement("p");
  line.className = event.level === "error" || String(event.kind).endsWith("_failed") ? "setup err" : "setup";
  line.dataset.id = event.id ?? "";
  line.textContent = event.detail ? `${event.title}：${event.detail}` : event.title || event.text || "";
  transcriptEl.appendChild(line);
}

function applySnapshot(snapshot) {
  for (const message of snapshot.messages ?? []) {
    state.events.set(message.id, message);
    if (message.role === "user") {
      addBubble("user", message.text, message.id);
      continue;
    }
    if (message.role === "assistant") {
      const node = addBubble("assistant", message.text, message.id);
      for (const tool of message.tools ?? []) {
        const el = document.createElement("div");
        el.className = tool.isError ? "tool err" : "tool";
        el.textContent = tool.isError ? `✗ ${tool.name}` : `✓ ${tool.name}`;
        node.appendChild(el);
      }
      if (message.streaming) state.assistant = node;
      continue;
    }
    if (message.role === "setup") {
      addSetupLine(message);
    }
  }
  state.lastEventId = snapshot.lastEventId ?? null;
}

function applyEvent(event) {
  if (state.events.has(event.id)) return;
  state.events.set(event.id, event);

  if (event.kind === "user.message") {
    const text = String(event.data?.text ?? "");
    const lastUser = [...transcriptEl.querySelectorAll(".bubble.user")].at(-1);
    if (!lastUser || lastUser.querySelector(".body")?.textContent !== text) {
      addBubble("user", text, event.id);
    }
    return;
  }

  if (event.kind === "message.delta") {
    const node = ensureAssistant();
    node.querySelector(".body").textContent += String(event.data?.delta ?? "");
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    return;
  }

  if (event.kind === "agent.start") {
    state.assistant = null;
    return;
  }

  if (
    String(event.kind).startsWith("scm.") ||
    String(event.kind).startsWith("run.install") ||
    String(event.kind).startsWith("run.start") ||
    String(event.kind).startsWith("run.terminal")
  ) {
    addSetupLine(event);
    if (event.kind === "scm.pr_opened" && event.data?.url) {
      showPullRequest({ pullRequests: [{ url: event.data.url, draft: event.data.draft !== false }] });
    }
    return;
  }

  if (event.kind === "tool.start") {
    const node = ensureAssistant();
    const tool = document.createElement("div");
    tool.className = "tool";
    const name = event.data?.toolName ?? "tool";
    const args = event.data?.args ? ` ${JSON.stringify(event.data.args)}` : "";
    tool.textContent = `$ ${name}${args}`;
    node.appendChild(tool);
    return;
  }

  if (event.kind === "tool.end") {
    const node = ensureAssistant();
    const tool = document.createElement("div");
    tool.className = event.data?.isError ? "tool err" : "tool";
    const name = event.data?.toolName ?? "tool";
    tool.textContent = event.data?.isError ? `✗ ${name}` : `✓ ${name}`;
    node.appendChild(tool);
    return;
  }

  if (event.kind === "run.error") {
    setStatus("ERROR");
    ensureAssistant().querySelector(".body").textContent += `\n${event.title}`;
  }

  if (event.kind === "run.install_started") setStatus("INSTALLING");
  if (event.kind === "run.running" || event.kind === "run.provisioning") setStatus("RUNNING");
  if (event.kind === "run.idle") setStatus("IDLE");
  if (event.kind === "run.archived") setStatus("ARCHIVED");
}

function closeStream() {
  state.source?.close();
  state.source = null;
}

function listen(runId, after) {
  closeStream();
  const query = after ? `?after=${encodeURIComponent(after)}` : "";
  state.source = new EventSource(`/v1/runs/${runId}/events${query}`);
  state.source.onopen = () => {
    if (state.healthText) healthEl.textContent = state.healthText;
  };
  state.source.onmessage = (message) => {
    const event = JSON.parse(message.data);
    state.lastEventId = event.id ?? state.lastEventId;
    applyEvent(event);
  };
  state.source.onerror = () => {
    healthEl.textContent = "事件流已断开，正在重试";
  };
}

async function refreshRuns() {
  const response = await fetch("/v1/runs");
  const body = await response.json();
  state.runs = body.runs ?? [];
  renderRuns();
}

async function openRun(runId) {
  const run = await (await fetch(`/v1/runs/${runId}`)).json();
  state.runId = run.id;
  state.events.clear();
  state.assistant = null;
  transcriptEl.innerHTML = "";
  runTitleEl.textContent = preview(run.prompt);
  setStatus(run.status);
  repoEl.value = run.repoUrls?.[0] ?? "";
  runLabelEl.textContent = run.branchName ? run.branchName : shortId(run.id);
  showPullRequest(run);
  renderRuns();
  const transcript = await (await fetch(`/v1/runs/${run.id}/transcript`)).json();
  if (transcript.snapshot) applySnapshot(transcript.snapshot);
  listen(run.id, transcript.snapshot?.lastEventId ?? state.lastEventId);
  history.replaceState(null, "", `/#/runs/${run.id}`);
}

function resetComposer() {
  state.runId = null;
  state.events.clear();
  state.assistant = null;
  state.lastEventId = null;
  closeStream();
  emptyState();
  setStatus("idle");
  runLabelEl.textContent = "新对话";
  runTitleEl.textContent = "和云端 Agent 说话";
  promptEl.value = "";
  showPullRequest(null);
  history.replaceState(null, "", "/");
  renderRuns();
}

async function sendMessage(text) {
  const repo = repoEl.value.trim();
  const repoUrls = repo ? [repo] : [];
  if (!state.runId) {
    addBubble("user", text, `local-${Date.now()}`);
    const created = await (
      await fetch("/v1/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, repoUrls, source: "web" }),
      })
    ).json();
    if (created.error) throw new Error(created.error);
    state.runs.unshift(created);
    await openRun(created.id);
    return;
  }
  addBubble("user", text, `local-${Date.now()}`);
  const follow = await (
    await fetch(`/v1/runs/${state.runId}/follow-ups`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    })
  ).json();
  if (follow.error) throw new Error(follow.error);
}

document.getElementById("composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptEl.value.trim();
  if (!text) return;
  promptEl.value = "";
  try {
    await sendMessage(text);
  } catch (error) {
    addBubble("assistant", error instanceof Error ? error.message : "发送失败", `err-${Date.now()}`);
  }
});

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    document.getElementById("composer").requestSubmit();
  }
});

document.getElementById("new-chat").addEventListener("click", resetComposer);

runListEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (button) void openRun(button.dataset.id);
});

abortEl.addEventListener("click", async () => {
  if (!state.runId) return;
  await fetch(`/v1/runs/${state.runId}/abort`, { method: "POST" });
});

openPrEl.addEventListener("click", async () => {
  if (!state.runId) return;
  openPrEl.disabled = true;
  try {
    const created = await (
      await fetch(`/v1/runs/${state.runId}/pull-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: runTitleEl.textContent || "Agent changes" }),
      })
    ).json();
    if (created.error) throw new Error(created.error);
    showPullRequest({ pullRequests: [created.pullRequest ?? created] });
  } catch (error) {
    addBubble("assistant", error instanceof Error ? error.message : "开 PR 失败", `err-${Date.now()}`);
  } finally {
    openPrEl.disabled = false;
  }
});

async function boot() {
  try {
    const health = await (await fetch("/health")).json();
    if (!health.ok) {
      state.healthText = "控制面异常";
    } else if (health.defaultModel) {
      const runtime = health.workerRuntime ? ` · ${health.workerRuntime}` : "";
      const store = health.objectStore ? ` · ${health.objectStore}` : "";
      state.healthText = `控制面在线 · ${health.defaultModel}${runtime}${store}`;
    } else {
      state.healthText = "控制面在线";
    }
    healthEl.textContent = state.healthText;
  } catch {
    state.healthText = "控制面不可达";
    healthEl.textContent = state.healthText;
  }
  await refreshRuns();
  const match = /^#\/runs\/([^/]+)$/.exec(location.hash);
  if (match?.[1]) {
    await openRun(match[1]);
  } else {
    emptyState();
  }
}

void boot();

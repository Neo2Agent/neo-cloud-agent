const transcriptEl = document.getElementById("transcript");
const runListEl = document.getElementById("run-list");
const promptEl = document.getElementById("prompt");
const repoEl = document.getElementById("repo");
const statusEl = document.getElementById("status");
const abortEl = document.getElementById("abort");
const healthEl = document.getElementById("health");
const runTitleEl = document.getElementById("run-title");
const runLabelEl = document.getElementById("run-label");

const state = {
  runId: null,
  runs: [],
  events: new Map(),
  source: null,
  assistant: null,
};

function shortId(id) {
  return id.slice(0, 8);
}

function preview(text) {
  return (text || "未命名任务").replace(/\s+/g, " ").slice(0, 42);
}

function setStatus(value) {
  statusEl.dataset.state = value;
  const labels = {
    idle: "就绪",
    PROVISIONING: "准备中",
    RUNNING: "运行中",
    IDLE: "空闲",
    ERROR: "出错",
    ARCHIVED: "已归档",
  };
  statusEl.textContent = labels[value] ?? value;
  abortEl.hidden = value !== "RUNNING" && value !== "PROVISIONING";
}

function emptyState() {
  transcriptEl.innerHTML = `
    <div class="empty">
      <h2>从一条任务开始</h2>
      <p>例如：列出工作区文件，或给当前项目加一个 README。第一条消息会创建 Run，后续消息作为跟进。</p>
    </div>
  `;
}

function renderRuns() {
  const items = [...state.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  runListEl.innerHTML = items
    .map(
      (run) => `
      <button class="run-item${run.id === state.runId ? " active" : ""}" data-id="${run.id}" type="button">
        <strong>${preview(run.prompt)}</strong>
        <small>${run.status} · ${shortId(run.id)}</small>
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

  if (event.kind === "run.error") {
    setStatus("ERROR");
    ensureAssistant().querySelector(".body").textContent += `\n${event.title}`;
  }

  if (event.kind === "run.running" || event.kind === "run.provisioning") setStatus("RUNNING");
  if (event.kind === "run.idle") setStatus("IDLE");
  if (event.kind === "run.archived") setStatus("ARCHIVED");
}

function closeStream() {
  state.source?.close();
  state.source = null;
}

function listen(runId) {
  closeStream();
  state.source = new EventSource(`/v1/runs/${runId}/events`);
  state.source.onmessage = (message) => {
    applyEvent(JSON.parse(message.data));
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
  runLabelEl.textContent = shortId(run.id);
  runTitleEl.textContent = preview(run.prompt);
  setStatus(run.status);
  repoEl.value = run.repoUrls?.[0] ?? "";
  renderRuns();
  listen(run.id);
  history.replaceState(null, "", `/#/runs/${run.id}`);
}

function resetComposer() {
  state.runId = null;
  state.events.clear();
  state.assistant = null;
  closeStream();
  emptyState();
  setStatus("idle");
  runLabelEl.textContent = "新对话";
  runTitleEl.textContent = "和云端 Agent 说话";
  promptEl.value = "";
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

async function boot() {
  try {
    const health = await (await fetch("/health")).json();
    if (!health.ok) {
      healthEl.textContent = "控制面异常";
    } else if (health.defaultModel) {
      healthEl.textContent = `控制面在线 · ${health.defaultModel}`;
    } else {
      healthEl.textContent = "控制面在线";
    }
  } catch {
    healthEl.textContent = "控制面不可达";
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

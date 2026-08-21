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
const authGateEl = document.getElementById("auth-gate");
const authFormEl = document.getElementById("auth-form");
const authTokenEl = document.getElementById("auth-token");
const authErrorEl = document.getElementById("auth-error");
const authTitleEl = document.getElementById("auth-title");
const authCopyEl = document.getElementById("auth-copy");
const authTabsEl = document.getElementById("auth-tabs");
const authUserFieldsEl = document.getElementById("auth-user-fields");
const authEmailEl = document.getElementById("auth-email");
const authPasswordEl = document.getElementById("auth-password");
const authSubmitEl = document.getElementById("auth-submit");
const accountEl = document.getElementById("account");
const accountEmailEl = document.getElementById("account-email");
const loginEl = document.getElementById("login");
const logoutEl = document.getElementById("logout");
const authSkipEl = document.getElementById("auth-skip");
const environmentEl = document.getElementById("environment");
const buildEl = document.getElementById("build");
const warmBuildEl = document.getElementById("warm-build");
const llmUpstreamEl = document.getElementById("llm-upstream");
const llmKeyEl = document.getElementById("llm-key");
const saveLlmEl = document.getElementById("save-llm");
const llmStatusEl = document.getElementById("llm-status");
const vmStatusEl = document.getElementById("vm-status");
const vmRailEl = document.getElementById("vm-rail");
const vmBadgeEl = document.getElementById("vm-badge");
const settingsPanelEl = document.getElementById("settings-panel");
const toggleSettingsEl = document.getElementById("toggle-settings");

const TOKEN_KEY = "neo.apiToken";
const SKIP_BOOTSTRAP_KEY = "neo.skipBootstrapLogin";

const state = {
  runId: null,
  runs: [],
  events: new Map(),
  source: null,
  assistant: null,
  lastEventId: null,
  healthText: "检测服务…",
  token: localStorage.getItem(TOKEN_KEY) || "",
  authRequired: false,
  accountsRequired: false,
  bootstrapEmail: "",
  bootstrapLogin: false,
  defaultAdmin: false,
  user: null,
  authMode: "login",
  authBusy: false,
  environments: [],
  builds: [],
  llm: { configured: false, upstream: "mock", model: null },
  vms: { total: 0, busy: 0, backend: "none", slots: [] },
};

function apiHeaders(json) {
  const headers = {};
  if (json) headers["content-type"] = "application/json";
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  return headers;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { ...apiHeaders(Boolean(options.body)), ...options.headers },
  });
  if (response.status === 401 && state.authRequired) {
    showAuthGate("访问令牌无效");
    throw new Error("unauthorized");
  }
  return response;
}

function showAuthGate(message) {
  if (!authGateEl) return;
  authGateEl.hidden = false;
  if (authErrorEl) {
    authErrorEl.hidden = !message;
    authErrorEl.textContent = message || "";
  }
  if (authSkipEl) authSkipEl.hidden = state.authRequired;
  setAuthMode(state.authMode || "login");
  if (state.authMode === "token") {
    if (authTokenEl) {
      authTokenEl.value = state.token.startsWith("neo_sess_") ? "" : state.token;
      authTokenEl.focus();
    }
    return;
  }
  if (authEmailEl && !authEmailEl.value) {
    authEmailEl.value = state.bootstrapEmail || "admin";
  }
  if (authPasswordEl && !authPasswordEl.value && state.authMode === "login") {
    authPasswordEl.value = "123456";
  }
  authEmailEl?.focus?.();
}

function hideAuthGate() {
  if (authGateEl) authGateEl.hidden = true;
  if (authErrorEl) authErrorEl.hidden = true;
}

function submitLabel(mode = state.authMode) {
  if (state.authBusy) return "登录中…";
  if (mode === "register") return "注册";
  if (mode === "token") return "使用令牌";
  return "登录";
}

function setAuthBusy(busy) {
  state.authBusy = busy;
  if (authSubmitEl) {
    authSubmitEl.disabled = busy;
    authSubmitEl.textContent = submitLabel();
  }
  if (loginEl) loginEl.disabled = busy;
}

function setAuthMode(mode) {
  state.authMode = mode;
  for (const button of authTabsEl?.querySelectorAll("button") ?? []) {
    button.classList.toggle("active", button.dataset.mode === mode);
  }
  const userMode = mode !== "token";
  if (authUserFieldsEl) authUserFieldsEl.hidden = !userMode;
  if (authTokenEl) authTokenEl.hidden = userMode;
  if (authTitleEl) {
    authTitleEl.textContent = mode === "register" ? "注册" : mode === "token" ? "服务令牌" : "登录";
  }
  if (authCopyEl) {
    authCopyEl.textContent =
      mode === "token"
        ? "控制面开启了服务令牌。多个设备用同一条 CONTROL_PLANE_TOKEN 即可订阅流。"
        : "默认管理员账号 admin，密码 123456。点登录即可。";
  }
  if (authSubmitEl && !state.authBusy) authSubmitEl.textContent = submitLabel(mode);
  if (authEmailEl) {
    authEmailEl.type = "text";
    authEmailEl.removeAttribute("pattern");
  }
}

function renderAccount() {
  if (!accountEl) return;
  accountEl.hidden = false;
  if (!state.user) {
    if (accountEmailEl) accountEmailEl.textContent = state.authBusy ? "登录中…" : "未登录";
    if (loginEl) loginEl.hidden = false;
    if (logoutEl) logoutEl.hidden = true;
    return;
  }
  if (accountEmailEl) accountEmailEl.textContent = state.user.email;
  if (loginEl) loginEl.hidden = true;
  if (logoutEl) logoutEl.hidden = false;
}

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
      <h2>直接说要做什么</h2>
      <p>发送后会占用一个空闲 VM。仓库和 API Key 在右上角「设置」里。</p>
    </div>
  `;
}

function slotLabel(id) {
  const raw = String(id || "");
  const match = /^slot-(\d+)$/.exec(raw);
  if (match) return `VM ${Number(match[1]) + 1}`;
  return raw || "未分配";
}

function runForSlot(slot) {
  return state.runs.find((item) => item.id === slot.runId || item.vmSlotId === slot.id);
}

function currentRun() {
  return state.runs.find((item) => item.id === state.runId) ?? null;
}

function currentSlotId() {
  const run = currentRun();
  if (run?.vmSlotId) return run.vmSlotId;
  return state.vms.slots.find((item) => item.runId === state.runId)?.id ?? null;
}

function applyVmSummary(payload) {
  if (!payload || typeof payload !== "object") return;
  state.vms = {
    total: payload.total || 0,
    busy: payload.busy || 0,
    backend: payload.backend || "none",
    slots: Array.isArray(payload.slots) ? payload.slots : [],
  };
  let dirty = false;
  for (const slot of state.vms.slots) {
    if (!slot.runId) continue;
    const run = state.runs.find((item) => item.id === slot.runId);
    if (run && run.vmSlotId !== slot.id) {
      run.vmSlotId = slot.id;
      dirty = true;
    }
  }
  if (dirty) renderRuns();
}

function renderVmBadge() {
  if (!vmBadgeEl) return;
  const id = currentSlotId();
  if (!id) {
    vmBadgeEl.textContent = state.runId ? "分配 VM 中…" : "未分配 VM";
    vmBadgeEl.dataset.busy = "false";
    return;
  }
  vmBadgeEl.textContent = `${slotLabel(id)} · ${id}`;
  vmBadgeEl.dataset.busy = "true";
}

function renderVmHint() {
  if (!vmStatusEl) return;
  const { total, busy, backend, slots } = state.vms;
  if (!total && slots.length === 0) {
    vmStatusEl.textContent = "未启用 VM 槽。";
    return;
  }
  const kind = backend === "loop" ? "loop 挂载" : backend === "kvm" ? "Firecracker" : backend;
  const id = currentSlotId();
  if (id) {
    vmStatusEl.textContent = `当前对话占用 ${slotLabel(id)}（${id}，${kind}）`;
    return;
  }
  const idle = Math.max(0, (total || slots.length) - busy);
  const count = total || slots.length;
  vmStatusEl.textContent =
    idle > 0
      ? `${idle}/${count} 个 VM 空闲，发送后占用其中一个（${kind}）。`
      : `${count} 个 VM 都在忙。打开已有对话，或等槽位释放。`;
}

function renderVmRail() {
  if (!vmRailEl) return;
  const slots = state.vms.slots || [];
  if (slots.length === 0) {
    const text = state.vms.total ? "VM 槽还在初始化" : "当前未启用 VM";
    vmRailEl.innerHTML = `<p class="hint">${escapeHtml(text)}</p>`;
    return;
  }
  vmRailEl.innerHTML = slots
    .map((slot) => {
      const occupant = runForSlot(slot);
      const busy = slot.status === "busy" || Boolean(slot.runId);
      const current = Boolean(state.runId && (slot.runId === state.runId || occupant?.id === state.runId));
      const title = occupant ? preview(occupant.prompt) : busy ? shortId(slot.runId || "") : "空闲";
      const openId = occupant?.id || slot.runId;
      const open = openId ? ` data-open="${escapeHtml(openId)}"` : "";
      return `<article class="vm-slot" data-busy="${busy}" data-current="${current}"${open}>
        <strong>${escapeHtml(slotLabel(slot.id))}</strong>
        <small>${busy ? "占用" : "空闲"} · ${escapeHtml(title)}</small>
      </article>`;
    })
    .join("");
}

function formatHealth(health) {
  if (!health?.ok) return "控制面异常";
  const provider = health.llmConfigured
    ? health.llmUpstream === "openai"
      ? "OpenAI"
      : health.llmUpstream === "deepseek"
        ? "DeepSeek"
        : String(health.llmUpstream || "LLM")
    : "未配置 Key";
  const total = state.vms.total || health.vmSlots?.total || 0;
  const busy = state.vms.busy ?? health.vmSlots?.busy ?? 0;
  const vm = total > 0 ? ` · VM ${busy}/${total}` : health.workerRuntime === "vm" ? " · VM" : "";
  return `在线 · ${provider}${vm}`;
}

async function refreshVms() {
  if (!(state.authRequired && !state.token)) {
    try {
      const response = await api("/v1/vms");
      if (response.ok) applyVmSummary(await response.json());
    } catch {
      // keep last known occupancy
    }
  }
  renderVmRail();
  renderVmBadge();
  renderVmHint();
}

function renderRuns() {
  const items = [...state.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  runListEl.innerHTML = items
    .map(
      (run) => `
      <button class="run-item${run.id === state.runId ? " active" : ""}" data-id="${escapeHtml(run.id)}" type="button">
        <strong>${escapeHtml(preview(run.prompt))}</strong>
        <small>${escapeHtml(STATUS_LABELS[run.status] ?? run.status)}${run.vmSlotId ? ` · ${escapeHtml(slotLabel(run.vmSlotId))}` : ""}</small>
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
    String(event.kind).startsWith("run.terminal") ||
    String(event.kind).startsWith("build.") ||
    String(event.kind).startsWith("egress.")
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
  if (
    event.kind === "run.running" ||
    event.kind === "run.provisioning" ||
    event.kind === "run.idle" ||
    event.kind === "run.archived" ||
    event.kind === "run.error"
  ) {
    void refreshVms();
  }
}

function closeStream() {
  state.source?.close();
  state.source = null;
}

function listen(runId, after) {
  closeStream();
  const params = new URLSearchParams();
  if (after) params.set("after", after);
  if (state.token) params.set("access_token", state.token);
  const query = params.toString() ? `?${params}` : "";
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
  const response = await api("/v1/runs");
  const body = await response.json();
  state.runs = body.runs ?? [];
  renderRuns();
  renderVmRail();
  renderVmBadge();
}

async function openRun(runId) {
  const run = await (await api(`/v1/runs/${runId}`)).json();
  state.runId = run.id;
  const existing = state.runs.findIndex((item) => item.id === run.id);
  if (existing >= 0) state.runs[existing] = { ...state.runs[existing], ...run };
  else state.runs.unshift(run);
  state.events.clear();
  state.assistant = null;
  transcriptEl.innerHTML = "";
  runTitleEl.textContent = preview(run.prompt);
  setStatus(run.status);
  repoEl.value = run.repoUrls?.[0] ?? "";
  environmentEl.value = run.envId ?? "";
  buildEl.value = run.buildId ?? "";
  runLabelEl.textContent = run.buildId
    ? `${run.branchName ? run.branchName : shortId(run.id)} · 快照 ${shortId(run.buildId)}`
    : run.branchName
      ? run.branchName
      : shortId(run.id);
  showPullRequest(run);
  renderRuns();
  renderVmBadge();
  void refreshVms();
  const transcript = await (await api(`/v1/runs/${run.id}/transcript`)).json();
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
  environmentEl.value = "";
  buildEl.value = "";
  showPullRequest(null);
  history.replaceState(null, "", "/");
  renderRuns();
  renderVmBadge();
  renderVmHint();
}

function selectedBuildPayload() {
  const value = buildEl.value;
  if (value === "cold") {
    return { reuseBuild: false };
  }
  if (value) {
    return { buildId: value, reuseBuild: true };
  }
  return { reuseBuild: true };
}

function renderEnvOptions() {
  const envValue = environmentEl.value;
  const buildValue = buildEl.value;
  environmentEl.innerHTML = `<option value="">仓库默认</option>${state.environments
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || shortId(item.id))}</option>`)
    .join("")}`;
  environmentEl.value = state.environments.some((item) => item.id === envValue) ? envValue : "";
  const envId = environmentEl.value;
  const builds = state.builds.filter((item) => item.status === "SUCCEEDED" && (!envId || item.envId === envId));
  buildEl.innerHTML = `<option value="">自动（复用 active）</option><option value="cold">冷装</option>${builds
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(shortId(item.id))}${item.draft ? " · draft" : ""}</option>`,
    )
    .join("")}`;
  buildEl.value = builds.some((item) => item.id === buildValue) || buildValue === "cold" ? buildValue : "";
}

function renderLlmSettings(settings) {
  state.llm = settings ?? { configured: false, upstream: "mock", model: null };
  if (llmUpstreamEl && state.llm.upstream && state.llm.upstream !== "mock") {
    llmUpstreamEl.value = state.llm.upstream;
  }
  if (llmKeyEl) {
    llmKeyEl.value = "";
    llmKeyEl.placeholder = state.llm.configured ? "已保存，留空则保持" : "sk-…";
  }
  if (llmStatusEl) {
    llmStatusEl.textContent = state.llm.configured
      ? `已配置 ${state.llm.upstream === "openai" ? "OpenAI" : "DeepSeek"}，对话走真实模型。`
      : "未配置 API Key，当前是 mock 回复。";
  }
}

async function refreshLlmSettings() {
  try {
    const settings = await (await api("/v1/settings/llm")).json();
    if (!settings.error) renderLlmSettings(settings);
  } catch {
    // optional until logged in
  }
}

async function refreshEnvironments() {
  try {
    const [envs, builds] = await Promise.all([
      api("/v1/environments").then((item) => item.json()),
      api("/v1/builds").then((item) => item.json()),
    ]);
    state.environments = envs.environments ?? [];
    state.builds = builds.builds ?? [];
    renderEnvOptions();
  } catch {
    // optional for unauthenticated health-only boot
  }
}

async function sendMessage(text) {
  const repo = repoEl.value.trim();
  const repoUrls = repo ? [repo] : [];
  if (!state.runId) {
    addBubble("user", text, `local-${Date.now()}`);
    const created = await (
      await api("/v1/runs", {
        method: "POST",
        body: JSON.stringify({
          prompt: text,
          repoUrls,
          source: "web",
          envId: environmentEl.value || undefined,
          ...selectedBuildPayload(),
        }),
      })
    ).json();
    if (created.error) throw new Error(created.error);
    state.runs.unshift(created);
    await openRun(created.id);
    return;
  }
  addBubble("user", text, `local-${Date.now()}`);
  const follow = await (
    await api(`/v1/runs/${state.runId}/follow-ups`, {
      method: "POST",
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

environmentEl.addEventListener("change", () => {
  renderEnvOptions();
});

llmKeyEl?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveLlmEl?.click();
  }
});

saveLlmEl?.addEventListener("click", async () => {
  const apiKey = llmKeyEl?.value.trim() ?? "";
  const upstream = llmUpstreamEl?.value || "deepseek";
  if (!apiKey && !state.llm?.configured) {
    if (llmStatusEl) llmStatusEl.textContent = "请先填写 API Key。";
    return;
  }
  saveLlmEl.disabled = true;
  try {
    const payload = {
      upstream,
      model: upstream === "openai" ? "gpt-4o-mini" : "deepseek-chat",
    };
    if (apiKey) payload.apiKey = apiKey;
    const saved = await (
      await api("/v1/settings/llm", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    ).json();
    if (saved.error === "login_required") throw new Error("请先登录再保存 API Key");
    if (saved.error) throw new Error(saved.error);
    renderLlmSettings(saved);
    try {
      const health = await (await fetch("/health")).json();
      state.healthText = formatHealth(health);
      healthEl.textContent = state.healthText;
    } catch {
      // occupancy footer is best-effort
    }
  } catch (error) {
    if (llmStatusEl) {
      llmStatusEl.textContent = error instanceof Error ? error.message : "保存失败";
    }
  } finally {
    saveLlmEl.disabled = false;
  }
});

warmBuildEl.addEventListener("click", async () => {
  const repo = repoEl.value.trim();
  if (!repo) {
    addBubble("assistant", "预热前先填仓库。", `err-${Date.now()}`);
    return;
  }
  warmBuildEl.disabled = true;
  try {
    const created = await (
      await api("/v1/builds", {
        method: "POST",
        body: JSON.stringify({
          repoUrls: [repo],
          envId: environmentEl.value || undefined,
        }),
      })
    ).json();
    if (created.error) throw new Error(created.error);
    await refreshEnvironments();
    if (created.id && created.status === "SUCCEEDED") {
      buildEl.value = created.id;
    }
    addBubble(
      "assistant",
      created.status === "SUCCEEDED" ? `环境快照已就绪 ${shortId(created.id)}` : `预热失败：${created.failureMessage || created.status}`,
      `build-${created.id || Date.now()}`,
    );
  } catch (error) {
    addBubble("assistant", error instanceof Error ? error.message : "预热失败", `err-${Date.now()}`);
  } finally {
    warmBuildEl.disabled = false;
  }
});

toggleSettingsEl?.addEventListener("click", () => {
  if (!settingsPanelEl) return;
  const open = settingsPanelEl.hidden;
  settingsPanelEl.hidden = !open;
  toggleSettingsEl.setAttribute("aria-expanded", String(open));
  toggleSettingsEl.textContent = open ? "收起设置" : "设置";
});

vmRailEl?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-open]");
  if (card?.dataset.open) void openRun(card.dataset.open);
});

runListEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (button) void openRun(button.dataset.id);
});

abortEl.addEventListener("click", async () => {
  if (!state.runId) return;
  await api(`/v1/runs/${state.runId}/abort`, { method: "POST" });
});

openPrEl.addEventListener("click", async () => {
  if (!state.runId) return;
  openPrEl.disabled = true;
  try {
    const created = await (
      await api(`/v1/runs/${state.runId}/pull-request`, {
        method: "POST",
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

function saveToken(token) {
  state.token = token;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function applyServiceToken(token) {
  saveToken(token);
  const response = await fetch("/v1/auth", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    saveToken("");
    throw new Error("unauthorized");
  }
  state.user = null;
  renderAccount();
  hideAuthGate();
}

async function applySession(token, user) {
  if (!token) {
    saveToken("");
    state.user = null;
    renderAccount();
    throw new Error("登录响应缺少会话");
  }
  saveToken(token);
  if (user?.email) {
    state.user = user;
    sessionStorage.removeItem(SKIP_BOOTSTRAP_KEY);
    renderAccount();
    hideAuthGate();
    return;
  }
  const me = await api("/v1/me");
  if (!me.ok) {
    saveToken("");
    state.user = null;
    renderAccount();
    throw new Error("unauthorized");
  }
  const body = await me.json();
  if (!body.user) {
    saveToken("");
    state.user = null;
    renderAccount();
    throw new Error("登录未生效，请再试一次");
  }
  state.user = body.user;
  sessionStorage.removeItem(SKIP_BOOTSTRAP_KEY);
  renderAccount();
  hideAuthGate();
}

async function loginBootstrap() {
  const response = await fetch("/v1/auth/bootstrap", {
    method: "POST",
    credentials: "same-origin",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "unauthorized");
  await applySession(body.token, body.user);
}

async function finishLogin() {
  await refreshRuns();
  await refreshEnvironments();
  await refreshLlmSettings();
  await refreshVms();
  const match = /^#\/runs\/([^/]+)$/.exec(location.hash);
  if (match?.[1]) await openRun(match[1]);
  else emptyState();
}

loginEl?.addEventListener("click", async () => {
  if (state.authBusy) return;
  showAuthGate();
  if (!state.bootstrapLogin && !state.defaultAdmin) return;
  setAuthBusy(true);
  renderAccount();
  try {
    await loginBootstrap();
    await finishLogin();
  } catch (error) {
    showAuthGate(error instanceof Error ? error.message : "登录失败");
  } finally {
    setAuthBusy(false);
    renderAccount();
  }
});

authSkipEl?.addEventListener("click", () => {
  hideAuthGate();
});

authGateEl?.addEventListener("click", (event) => {
  if (event.target === authGateEl && !state.authRequired) {
    hideAuthGate();
  }
});

authTabsEl?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (!button) return;
  const mode = button.dataset.mode;
  if (mode === "login" && state.authMode === "login") {
    authFormEl?.requestSubmit?.();
    return;
  }
  setAuthMode(mode);
});

authFormEl?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.authBusy) return;
  setAuthBusy(true);
  try {
    if (state.authMode === "token") {
      await applyServiceToken(authTokenEl?.value.trim() ?? "");
    } else {
      const email = (authEmailEl?.value ?? "").trim() || state.bootstrapEmail || "admin";
      const password = authPasswordEl?.value || (state.authMode === "login" ? "123456" : "");
      const path = state.authMode === "register" ? "/v1/auth/register" : "/v1/auth/login";
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "unauthorized");
      await applySession(body.token, body.user);
    }
    await finishLogin();
  } catch (error) {
    showAuthGate(error instanceof Error ? error.message : "登录失败");
  } finally {
    setAuthBusy(false);
  }
});

logoutEl?.addEventListener("click", async () => {
  try {
    await api("/v1/auth/logout", { method: "POST" });
  } catch {
    // ignore
  }
  saveToken("");
  state.user = null;
  sessionStorage.setItem(SKIP_BOOTSTRAP_KEY, "1");
  renderAccount();
  state.runs = [];
  resetComposer();
  if (state.authRequired) showAuthGate();
});

async function boot() {
  try {
    const health = await (await fetch("/health")).json();
    state.authRequired = health.authRequired === true;
    state.accountsRequired = health.accountsRequired === true;
    applyVmSummary(health.vmSlots);
    state.healthText = formatHealth(health);
    healthEl.textContent = state.healthText;
    renderVmRail();
    renderVmHint();
    state.bootstrapEmail = typeof health.bootstrapEmail === "string" ? health.bootstrapEmail : "";
    state.bootstrapLogin = health.bootstrapLogin === true;
    state.defaultAdmin = health.defaultAdmin === true;
    if (authEmailEl && state.bootstrapEmail) authEmailEl.value = state.bootstrapEmail;
    if (authPasswordEl && state.defaultAdmin) authPasswordEl.value = "123456";
    renderAccount();
    if (state.token) {
      try {
        if (state.token.startsWith("neo_sess_")) await applySession(state.token);
        else await applyServiceToken(state.token);
      } catch {
        if (state.bootstrapLogin && sessionStorage.getItem(SKIP_BOOTSTRAP_KEY) !== "1") {
          try {
            await loginBootstrap();
          } catch {
            if (state.authRequired) {
              showAuthGate("请重新登录");
              return;
            }
          }
        } else if (state.authRequired) {
          showAuthGate("请重新登录");
          return;
        }
      }
    } else if (state.bootstrapLogin && sessionStorage.getItem(SKIP_BOOTSTRAP_KEY) !== "1") {
      try {
        await loginBootstrap();
      } catch {
        if (state.authRequired) {
          showAuthGate();
          return;
        }
      }
    } else if (state.authRequired) {
      showAuthGate();
      return;
    }
  } catch {
    state.healthText = "控制面不可达";
    healthEl.textContent = state.healthText;
  }
  await refreshRuns();
  await refreshEnvironments();
  await refreshLlmSettings();
  await refreshVms();
  const match = /^#\/runs\/([^/]+)$/.exec(location.hash);
  if (match?.[1]) {
    await openRun(match[1]);
  } else {
    emptyState();
    renderVmBadge();
  }
}

window.setInterval(() => {
  if (state.authRequired && !state.token) return;
  void (async () => {
    try {
      const health = await (await fetch("/health")).json();
      applyVmSummary(health.vmSlots);
      state.healthText = formatHealth(health);
      healthEl.textContent = state.healthText;
    } catch {
      // keep last health line
    }
    if (state.runId) await refreshRuns();
    await refreshVms();
  })();
}, 5000);

void boot();

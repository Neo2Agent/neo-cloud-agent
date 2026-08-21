import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildTranscriptSnapshot } from "@neo-cloud-agent/contracts/transcript";
import type { RunEvent, TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { api, readJson, readToken, writeToken } from "./api";
import { AuthGate } from "./components/AuthGate";
import { Composer, type BuildOption, type EnvOption, type LlmSettings } from "./components/Composer";
import { Sidebar, type VmSlotView } from "./components/Sidebar";
import { Transcript } from "./components/Transcript";
import { preview, shortId, slotLabel, STATUS_LABELS } from "./format";

const SKIP_BOOTSTRAP_KEY = "neo.skipBootstrapLogin";
const HISTORY_PAGE = 40;

type VmSummary = {
  total: number;
  busy: number;
  backend: string;
  slots: VmSlotView[];
};

type Health = {
  ok?: boolean;
  authRequired?: boolean;
  accountsRequired?: boolean;
  bootstrapEmail?: string;
  bootstrapLogin?: boolean;
  defaultAdmin?: boolean;
  llmConfigured?: boolean;
  llmUpstream?: string;
  workerRuntime?: string;
  vmSlots?: VmSummary;
};

type PullRequest = { url?: string; draft?: boolean };

function formatHealth(health: Health | null, vms: VmSummary): string {
  if (!health?.ok) return "控制面异常";
  const provider = health.llmConfigured
    ? health.llmUpstream === "openai"
      ? "OpenAI"
      : health.llmUpstream === "deepseek"
        ? "DeepSeek"
        : String(health.llmUpstream || "LLM")
    : "未配置 Key";
  const total = vms.total || health.vmSlots?.total || 0;
  const busy = vms.busy ?? health.vmSlots?.busy ?? 0;
  const vm = total > 0 ? ` · VM ${busy}/${total}` : health.workerRuntime === "vm" ? " · VM" : "";
  return `在线 · ${provider}${vm}`;
}

function hashRunId(): string | null {
  return /^#\/runs\/([^/]+)$/.exec(location.hash)?.[1] ?? null;
}

export function App() {
  const [token, setToken] = useState(readToken);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [shownFrom, setShownFrom] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthText, setHealthText] = useState("检测服务…");
  const [vms, setVms] = useState<VmSummary>({ total: 0, busy: 0, backend: "none", slots: [] });
  const [userEmail, setUserEmail] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [bootstrapEmail, setBootstrapEmail] = useState("");
  const [bootstrapLogin, setBootstrapLogin] = useState(false);
  const [defaultAdmin, setDefaultAdmin] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | "token">("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authEmail, setAuthEmail] = useState("admin");
  const [authPassword, setAuthPassword] = useState("123456");
  const [authToken, setAuthToken] = useState("");
  const [prompt, setPrompt] = useState("");
  const [repo, setRepo] = useState("");
  const [envId, setEnvId] = useState("");
  const [buildId, setBuildId] = useState("");
  const [environments, setEnvironments] = useState<EnvOption[]>([]);
  const [builds, setBuilds] = useState<BuildOption[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llm, setLlm] = useState<LlmSettings>({ configured: false, upstream: "deepseek", model: null });
  const [llmKey, setLlmKey] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem("neo.sidebar");
    if (saved === "0") return false;
    if (saved === "1") return true;
    return window.innerWidth >= 860;
  });
  const sourceRef = useRef<EventSource | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const snapshot = useMemo(() => buildTranscriptSnapshot(runId ?? "local", events), [runId, events]);
  const visibleMessages = snapshot.messages.slice(shownFrom);
  const remaining = shownFrom;

  const applyVms = useCallback((payload?: Partial<VmSummary> | null) => {
    if (!payload) return;
    setVms({
      total: payload.total || 0,
      busy: payload.busy || 0,
      backend: payload.backend || "none",
      slots: payload.slots || [],
    });
  }, []);

  const persistToken = useCallback((next: string) => {
    writeToken(next);
    setToken(next);
  }, []);

  const closeStream = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const listen = useCallback(
    (id: string, after?: string | null) => {
      closeStream();
      const params = new URLSearchParams();
      if (after) params.set("after", after);
      if (tokenRef.current) params.set("access_token", tokenRef.current);
      const query = params.toString() ? `?${params}` : "";
      const source = new EventSource(`/v1/runs/${id}/events${query}`);
      source.onmessage = (message) => {
        const event = JSON.parse(message.data) as RunEvent;
        setEvents((prev) => (prev.some((item) => item.id === event.id) ? prev : [...prev, event]));
        if (event.kind === "scm.pr_opened" && event.data?.url) {
          setCurrentRun((run) =>
            run
              ? {
                  ...run,
                  pullRequests: [{ url: String(event.data?.url), draft: event.data?.draft !== false, repoUrl: "", branch: "", number: null, title: "" }],
                }
              : run,
          );
        }
        if (event.kind === "run.install_started") {
          setCurrentRun((run) => (run ? { ...run, status: "INSTALLING" } : run));
        }
        if (event.kind === "run.running" || event.kind === "run.provisioning") {
          setCurrentRun((run) => (run ? { ...run, status: event.kind === "run.provisioning" ? "PROVISIONING" : "RUNNING" } : run));
        }
        if (event.kind === "run.idle") setCurrentRun((run) => (run ? { ...run, status: "IDLE" } : run));
        if (event.kind === "run.archived") setCurrentRun((run) => (run ? { ...run, status: "ARCHIVED" } : run));
        if (event.kind === "run.error") setCurrentRun((run) => (run ? { ...run, status: "ERROR" } : run));
      };
      source.onerror = () => {
        setHealthText("事件流已断开，正在重试");
      };
      sourceRef.current = source;
    },
    [closeStream],
  );

  const refreshVms = useCallback(async () => {
    if (authRequired && !tokenRef.current) return;
    try {
      const response = await api(tokenRef.current, "/v1/vms");
      if (response.ok) applyVms(await readJson<VmSummary>(response));
    } catch {
      // keep last occupancy
    }
  }, [applyVms, authRequired]);

  const refreshRuns = useCallback(async () => {
    const response = await api(tokenRef.current, "/v1/runs");
    if (!response.ok) return;
    const body = await readJson<{ runs?: Run[] }>(response);
    setRuns(body.runs ?? []);
  }, []);

  const refreshEnvironments = useCallback(async () => {
    try {
      const [envRes, buildRes] = await Promise.all([
        api(tokenRef.current, "/v1/environments"),
        api(tokenRef.current, "/v1/builds"),
      ]);
      if (envRes.ok) {
        const body = await readJson<{ environments?: EnvOption[] }>(envRes);
        setEnvironments(body.environments ?? []);
      }
      if (buildRes.ok) {
        const body = await readJson<{ builds?: BuildOption[] }>(buildRes);
        setBuilds(body.builds ?? []);
      }
    } catch {
      // optional until logged in
    }
  }, []);

  const refreshLlm = useCallback(async () => {
    try {
      const response = await api(tokenRef.current, "/v1/settings/llm");
      if (!response.ok) return;
      const settings = await readJson<LlmSettings & { error?: string }>(response);
      if (!settings.error) {
        setLlm({
          configured: settings.configured,
          upstream: settings.upstream || "deepseek",
          model: settings.model,
        });
        setLlmKey("");
      }
    } catch {
      // optional
    }
  }, []);

  const resetComposer = useCallback(() => {
    closeStream();
    setRunId(null);
    setCurrentRun(null);
    setEvents([]);
    setShownFrom(0);
    setPrompt("");
    setEnvId("");
    setBuildId("");
    history.replaceState(null, "", "/");
  }, [closeStream]);

  const openRun = useCallback(
    async (id: string) => {
      const runRes = await api(tokenRef.current, `/v1/runs/${id}`);
      if (!runRes.ok) return;
      const run = await readJson<Run>(runRes);
      setRunId(run.id);
      setCurrentRun(run);
      setRepo(run.repoUrls?.[0] ?? "");
      setEnvId(run.envId ?? "");
      setBuildId(run.buildId ?? "");
      setRuns((prev) => {
        const index = prev.findIndex((item) => item.id === run.id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = { ...next[index], ...run };
          return next;
        }
        return [run, ...prev];
      });
      const transcript = await readJson<{ events?: RunEvent[]; snapshot?: { lastEventId?: string | null } }>(
        await api(tokenRef.current, `/v1/runs/${run.id}/transcript`),
      );
      const loaded = transcript.events ?? [];
      setEvents(loaded);
      const built = buildTranscriptSnapshot(run.id, loaded);
      setShownFrom(Math.max(0, built.messages.length - HISTORY_PAGE));
      listen(run.id, transcript.snapshot?.lastEventId ?? built.lastEventId);
      history.replaceState(null, "", `/#/runs/${run.id}`);
      void refreshVms();
    },
    [listen, refreshVms],
  );

  const finishLogin = useCallback(async () => {
    await Promise.all([refreshRuns(), refreshEnvironments(), refreshLlm(), refreshVms()]);
    const match = hashRunId();
    if (match) await openRun(match);
    else resetComposer();
  }, [openRun, refreshEnvironments, refreshLlm, refreshRuns, refreshVms, resetComposer]);

  const applySession = useCallback(
    async (nextToken: string, user?: { email?: string } | null) => {
      if (!nextToken) throw new Error("登录响应缺少会话");
      persistToken(nextToken);
      if (user?.email) {
        setUserEmail(user.email);
        sessionStorage.removeItem(SKIP_BOOTSTRAP_KEY);
        setAuthOpen(false);
        setAuthError("");
        return;
      }
      const me = await api(nextToken, "/v1/me");
      if (!me.ok) {
        persistToken("");
        setUserEmail("");
        throw new Error("unauthorized");
      }
      const body = await readJson<{ user?: { email?: string } }>(me);
      if (!body.user) {
        persistToken("");
        setUserEmail("");
        throw new Error("登录未生效，请再试一次");
      }
      setUserEmail(body.user.email ?? "");
      sessionStorage.removeItem(SKIP_BOOTSTRAP_KEY);
      setAuthOpen(false);
      setAuthError("");
    },
    [persistToken],
  );

  const loginBootstrap = useCallback(async () => {
    const response = await fetch("/v1/auth/bootstrap", { method: "POST", credentials: "same-origin" });
    const body = await readJson<{ token?: string; user?: { email?: string }; error?: string }>(response);
    if (!response.ok) throw new Error(body.error || "unauthorized");
    await applySession(body.token ?? "", body.user);
  }, [applySession]);

  const sendMessage = useCallback(async () => {
    const text = prompt.trim();
    if (!text) return;
    setPrompt("");
    const repoUrls = repo.trim() ? [repo.trim()] : [];
    const buildPayload = buildId === "cold" ? { reuseBuild: false } : buildId ? { buildId, reuseBuild: true } : { reuseBuild: true };
    try {
      if (!runId) {
        const created = await readJson<Run & { error?: string }>(
          await api(tokenRef.current, "/v1/runs", {
            method: "POST",
            body: JSON.stringify({ prompt: text, repoUrls, source: "web", envId: envId || undefined, ...buildPayload }),
          }),
        );
        if (created.error) throw new Error(created.error);
        setRuns((prev) => [created, ...prev]);
        await openRun(created.id);
        return;
      }
      const follow = await readJson<{ error?: string }>(
        await api(tokenRef.current, `/v1/runs/${runId}/follow-ups`, {
          method: "POST",
          body: JSON.stringify({ text }),
        }),
      );
      if (follow.error) throw new Error(follow.error);
    } catch (error) {
      setEvents((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          runId: runId ?? "local",
          createdAt: new Date().toISOString(),
          category: "agent_run",
          level: "error",
          kind: "run.error",
          title: error instanceof Error ? error.message : "发送失败",
        },
      ]);
    }
  }, [buildId, envId, openRun, prompt, repo, runId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await readJson<Health>(await fetch("/health"));
        if (cancelled) return;
        setHealth(payload);
        setAuthRequired(payload.authRequired === true);
        setBootstrapEmail(typeof payload.bootstrapEmail === "string" ? payload.bootstrapEmail : "");
        setBootstrapLogin(payload.bootstrapLogin === true);
        setDefaultAdmin(payload.defaultAdmin === true);
        if (payload.bootstrapEmail) setAuthEmail(payload.bootstrapEmail);
        if (payload.defaultAdmin) setAuthPassword("123456");
        applyVms(payload.vmSlots);
        setHealthText(formatHealth(payload, payload.vmSlots ?? vms));
        const saved = tokenRef.current;
        try {
          if (saved) {
            if (saved.startsWith("neo_sess_")) await applySession(saved);
            else {
              persistToken(saved);
              setUserEmail("");
              setAuthOpen(false);
            }
          } else if (payload.bootstrapLogin && sessionStorage.getItem(SKIP_BOOTSTRAP_KEY) !== "1") {
            await loginBootstrap();
          } else if (payload.authRequired) {
            setAuthOpen(true);
            return;
          }
        } catch {
          if (payload.bootstrapLogin && sessionStorage.getItem(SKIP_BOOTSTRAP_KEY) !== "1") {
            try {
              await loginBootstrap();
            } catch {
              if (payload.authRequired) {
                setAuthError("请重新登录");
                setAuthOpen(true);
                return;
              }
            }
          } else if (payload.authRequired) {
            setAuthError("请重新登录");
            setAuthOpen(true);
            return;
          }
        }
        await finishLogin();
      } catch {
        if (!cancelled) setHealthText("控制面不可达");
      }
    })();
    return () => {
      cancelled = true;
    };
    // boot once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (authRequired && !tokenRef.current) return;
      void (async () => {
        try {
          const payload = await readJson<Health>(await fetch("/health"));
          setHealth(payload);
          applyVms(payload.vmSlots);
          setHealthText(formatHealth(payload, payload.vmSlots ?? vms));
        } catch {
          // keep last
        }
        if (runId) await refreshRuns();
        await refreshVms();
      })();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [applyVms, authRequired, refreshRuns, refreshVms, runId, vms]);

  useEffect(() => () => closeStream(), [closeStream]);

  const busy = currentRun && ["RUNNING", "PROVISIONING", "INSTALLING"].includes(currentRun.status);
  const pr = currentRun?.pullRequests?.[0] as PullRequest | undefined;
  const currentSlot = currentRun?.vmSlotId || vms.slots.find((slot) => slot.runId === runId)?.id || null;
  const vmHint = !vms.total && vms.slots.length === 0
    ? "未启用 VM 槽。"
    : currentSlot
      ? `当前对话占用 ${slotLabel(currentSlot)}（${currentSlot}，${vms.backend === "loop" ? "loop 挂载" : vms.backend}）`
      : Math.max(0, (vms.total || vms.slots.length) - vms.busy) > 0
        ? `${Math.max(0, (vms.total || vms.slots.length) - vms.busy)}/${vms.total || vms.slots.length} 个 VM 空闲，发送后占用其中一个（${vms.backend === "loop" ? "loop 挂载" : vms.backend}）。`
        : `${vms.total || vms.slots.length} 个 VM 都在忙。打开已有对话，或等槽位释放。`;

  const loadOlder = () => {
    if (shownFrom <= 0) return;
    setShownFrom((value) => Math.max(0, value - HISTORY_PAGE));
  };

  const toggleSidebar = () => {
    setSidebarOpen((value) => {
      const next = !value;
      window.localStorage.setItem("neo.sidebar", next ? "1" : "0");
      return next;
    });
  };

  return (
    <>
      <div className={sidebarOpen ? "app" : "app sidebar-closed"}>
        {sidebarOpen ? <div className="sidebar-backdrop" id="sidebar-backdrop" onClick={toggleSidebar} /> : null}
        <Sidebar
          runs={runs}
          currentRunId={runId}
          slots={vms.slots}
          backend={vms.backend}
          userEmail={userEmail}
          authed={Boolean(userEmail)}
          authBusy={authBusy}
          health={healthText}
          onClose={toggleSidebar}
          onNewChat={resetComposer}
          onOpenRun={(id) => {
            setSidebarOpen((open) => {
              if (window.innerWidth < 860 && open) {
                window.localStorage.setItem("neo.sidebar", "0");
                return false;
              }
              return open;
            });
            void openRun(id);
          }}
          onLogin={() => {
            setAuthOpen(true);
            if (!bootstrapLogin && !defaultAdmin) return;
            setAuthBusy(true);
            void loginBootstrap()
              .then(() => finishLogin())
              .catch((error) => {
                setAuthError(error instanceof Error ? error.message : "登录失败");
                setAuthOpen(true);
              })
              .finally(() => setAuthBusy(false));
          }}
          onLogout={() => {
            void api(token, "/v1/auth/logout", { method: "POST" });
            persistToken("");
            setUserEmail("");
            sessionStorage.setItem(SKIP_BOOTSTRAP_KEY, "1");
            setRuns([]);
            resetComposer();
            if (authRequired) setAuthOpen(true);
          }}
        />
        <main className="main">
          <header className="topbar">
            <div>
              <button className="ghost sidebar-toggle" id="sidebar-toggle" type="button" onClick={toggleSidebar}>
                {sidebarOpen ? "收起侧栏" : "对话列表"}
              </button>
              <p className="eyebrow" id="run-label">
                {currentRun
                  ? currentRun.buildId
                    ? `${currentRun.branchName ?? shortId(currentRun.id)} · 快照 ${shortId(currentRun.buildId)}`
                    : currentRun.branchName ?? shortId(currentRun.id)
                  : "新对话"}
              </p>
              <h1 id="run-title">{currentRun ? preview(currentRun.prompt) : "和云端 Agent 说话"}</h1>
            </div>
            <div className="top-actions">
              <span className="vm-badge" id="vm-badge" data-busy={currentSlot ? "true" : "false"}>
                {currentSlot ? `${slotLabel(currentSlot)} · ${currentSlot}` : runId ? "分配 VM 中…" : "未分配 VM"}
              </span>
              <span className="status" id="status" data-state={currentRun?.status ?? "idle"}>
                {STATUS_LABELS[currentRun?.status ?? "idle"] ?? currentRun?.status ?? "就绪"}
              </span>
              <button
                className="ghost"
                id="toggle-settings"
                type="button"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((value) => !value)}
              >
                {settingsOpen ? "收起设置" : "设置"}
              </button>
              {pr?.url ? (
                <a className="pr-link" id="pr-link" href={pr.url} target="_blank" rel="noreferrer">
                  {pr.draft === false ? "PR" : "草稿 PR"}
                </a>
              ) : null}
              <button
                className="ghost"
                id="open-pr"
                type="button"
                hidden={Boolean(pr?.url) || !runId}
                onClick={async () => {
                  if (!runId) return;
                  try {
                    const created = await readJson<{ error?: string; pullRequest?: PullRequest }>(
                      await api(token, `/v1/runs/${runId}/pull-request`, {
                        method: "POST",
                        body: JSON.stringify({ title: currentRun?.prompt || "Agent changes" }),
                      }),
                    );
                    if (created.error) throw new Error(created.error);
                    const next = created.pullRequest ?? created;
                    setCurrentRun((run) => (run ? { ...run, pullRequests: [next as Run["pullRequests"][number]] } : run));
                  } catch (error) {
                    setEvents((prev) => [
                      ...prev,
                      {
                        id: `err-${Date.now()}`,
                        runId,
                        createdAt: new Date().toISOString(),
                        category: "agent_run",
                        level: "error",
                        kind: "run.error",
                        title: error instanceof Error ? error.message : "开 PR 失败",
                      },
                    ]);
                  }
                }}
              >
                开草稿 PR
              </button>
              <button
                className="ghost"
                id="abort"
                type="button"
                hidden={!busy}
                onClick={() => {
                  if (runId) void api(token, `/v1/runs/${runId}/abort`, { method: "POST" });
                }}
              >
                停止
              </button>
            </div>
          </header>
          <Transcript
            messages={visibleMessages as TranscriptMessage[]}
            remaining={remaining}
            empty={!runId && snapshot.messages.length === 0}
            onLoadOlder={loadOlder}
          />
          <Composer
            prompt={prompt}
            repo={repo}
            envId={envId}
            buildId={buildId}
            environments={environments}
            builds={builds}
            settingsOpen={settingsOpen}
            llm={llm}
            llmKey={llmKey}
            vmHint={vmHint}
            onPrompt={setPrompt}
            onRepo={setRepo}
            onEnv={setEnvId}
            onBuild={setBuildId}
            onLlmUpstream={(value) => setLlm((prev) => ({ ...prev, upstream: value }))}
            onLlmKey={setLlmKey}
            onSaveLlm={() => {
              void (async () => {
                if (!llmKey && !llm.configured) return;
                const payload: Record<string, string> = {
                  upstream: llm.upstream || "deepseek",
                  model: llm.upstream === "openai" ? "gpt-4o-mini" : "deepseek-chat",
                };
                if (llmKey) payload.apiKey = llmKey;
                const saved = await readJson<LlmSettings & { error?: string }>(
                  await api(token, "/v1/settings/llm", { method: "POST", body: JSON.stringify(payload) }),
                );
                if (saved.error === "login_required") throw new Error("请先登录再保存 API Key");
                if (saved.error) throw new Error(saved.error);
                setLlm({ configured: saved.configured, upstream: saved.upstream, model: saved.model });
                setLlmKey("");
                const nextHealth = await readJson<Health>(await fetch("/health"));
                setHealth(nextHealth);
                setHealthText(formatHealth(nextHealth, vms));
              })().catch((error) => {
                setLlm((prev) => ({ ...prev, model: error instanceof Error ? error.message : "保存失败" }));
              });
            }}
            onWarm={() => {
              void (async () => {
                if (!repo.trim()) {
                  setEvents((prev) => [
                    ...prev,
                    {
                      id: `err-${Date.now()}`,
                      runId: runId ?? "local",
                      createdAt: new Date().toISOString(),
                      category: "agent_setup",
                      level: "error",
                      kind: "run.error",
                      title: "预热前先填仓库。",
                    },
                  ]);
                  return;
                }
                const created = await readJson<{ id?: string; status?: string; error?: string; failureMessage?: string }>(
                  await api(token, "/v1/builds", {
                    method: "POST",
                    body: JSON.stringify({ repoUrls: [repo.trim()], envId: envId || undefined }),
                  }),
                );
                if (created.error) throw new Error(created.error);
                await refreshEnvironments();
                if (created.id && created.status === "SUCCEEDED") setBuildId(created.id);
              })().catch((error) => {
                setEvents((prev) => [
                  ...prev,
                  {
                    id: `err-${Date.now()}`,
                    runId: runId ?? "local",
                    createdAt: new Date().toISOString(),
                    category: "agent_setup",
                    level: "error",
                    kind: "run.error",
                    title: error instanceof Error ? error.message : "预热失败",
                  },
                ]);
              });
            }}
            onSend={() => void sendMessage()}
          />
        </main>
      </div>
      <AuthGate
        open={authOpen}
        mode={authMode}
        busy={authBusy}
        error={authError}
        canSkip={!authRequired}
        email={authEmail}
        password={authPassword}
        token={authToken}
        onClose={() => setAuthOpen(false)}
        onMode={setAuthMode}
        onEmail={setAuthEmail}
        onPassword={setAuthPassword}
        onToken={setAuthToken}
        onSubmit={() => {
          if (authBusy) return;
          setAuthBusy(true);
          void (async () => {
            if (authMode === "token") {
              persistToken(authToken.trim());
              const response = await fetch("/v1/auth", {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ token: authToken.trim() }),
              });
              if (!response.ok) {
                persistToken("");
                throw new Error("unauthorized");
              }
              setUserEmail("");
              setAuthOpen(false);
            } else {
              const email = authEmail.trim() || bootstrapEmail || "admin";
              const password = authPassword || (authMode === "login" ? "123456" : "");
              const path = authMode === "register" ? "/v1/auth/register" : "/v1/auth/login";
              const response = await fetch(path, {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email, password }),
              });
              const body = await readJson<{ token?: string; user?: { email?: string }; error?: string }>(response);
              if (!response.ok) throw new Error(body.error || "unauthorized");
              await applySession(body.token ?? "", body.user);
            }
            await finishLogin();
          })()
            .catch((error) => {
              setAuthError(error instanceof Error ? error.message : "登录失败");
              setAuthOpen(true);
            })
            .finally(() => setAuthBusy(false));
        }}
      />
    </>
  );
}

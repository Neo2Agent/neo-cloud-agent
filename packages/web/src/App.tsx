import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildTranscriptSnapshot } from "@neo-cloud-agent/contracts/transcript";
import type { RunEvent, TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import type { ImageRef, Run } from "@neo-cloud-agent/contracts/run";
import { api, readJson, readToken, writeToken } from "./api";
import { AuthGate } from "./components/AuthGate";
import { Composer } from "./components/Composer";
import { DiffPanel } from "./components/DiffPanel";
import { FileTree } from "./components/FileTree";
import { SettingsPanel, type BuildOption, type EnvOption, type LlmSettings } from "./components/SettingsPanel";
import { Sidebar, type VmSlotView } from "./components/Sidebar";
import { Transcript } from "./components/Transcript";
import { formatUsage, modelLabel, preview, shortId, slotLabel } from "./format";
import {
  activityLabel,
  isActiveRunStatus,
  isAssistantStreaming,
  isComposerClosed,
  isTerminalTurnEvent,
  isTurnBusy,
  pendingUserArrived,
  runningToolName,
  statusFromEventKind,
  turnStatusLabel,
  withPendingUser,
  type PendingUser,
} from "./turn";

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
  llmModel?: string | null;
  workerRuntime?: string;
  vmSlots?: VmSummary;
};

type PullRequest = { url?: string; draft?: boolean };

function formatHealth(health: Health | null, vms: VmSummary): string {
  if (!health?.ok) return "控制面异常";
  const provider = health.llmConfigured
    ? modelLabel(health.llmUpstream, health.llmModel)
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
  const [images, setImages] = useState<ImageRef[]>([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [diffStat, setDiffStat] = useState("");
  const [diffPatch, setDiffPatch] = useState("");
  const [repo, setRepo] = useState("");
  const [envId, setEnvId] = useState("");
  const [buildId, setBuildId] = useState("");
  const [environments, setEnvironments] = useState<EnvOption[]>([]);
  const [builds, setBuilds] = useState<BuildOption[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llm, setLlm] = useState<LlmSettings>({ configured: false, upstream: "deepseek", model: null });
  const [llmKey, setLlmKey] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<PendingUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem("neo.sidebar");
    if (saved === "0") return false;
    if (saved === "1") return true;
    return window.innerWidth >= 860;
  });
  const sourceRef = useRef<EventSource | null>(null);
  const tokenRef = useRef(token);
  const sendingRef = useRef(false);
  const pendingRef = useRef<PendingUser | null>(null);
  const keepPendingRef = useRef(false);
  tokenRef.current = token;
  sendingRef.current = sending;
  pendingRef.current = pendingTurn;

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

  const patchRun = useCallback((id: string, patch: (run: Run) => Run) => {
    setCurrentRun((run) => (run && run.id === id ? patch(run) : run));
    setRuns((prev) => prev.map((run) => (run.id === id ? patch(run) : run)));
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
        const nextStatus = statusFromEventKind(event.kind, undefined);
        if (nextStatus || event.kind === "user.message" || event.kind === "followup.queued" || event.kind === "agent.end") {
          patchRun(id, (run) => {
            const status = statusFromEventKind(event.kind, run.status);
            return status ? { ...run, status: status as Run["status"] } : run;
          });
        }
        if (isTerminalTurnEvent(event.kind)) {
          setStopping(false);
          setSending(false);
        }
        if (event.kind === "scm.pr_opened" && event.data?.url) {
          patchRun(id, (run) => ({
            ...run,
            pullRequests: [{ url: String(event.data?.url), draft: event.data?.draft !== false, repoUrl: "", branch: "", number: null, title: "" }],
          }));
        }
        if (event.kind === "llm.usage") {
          patchRun(id, (run) => {
            const promptTokens = Number(event.data?.promptTokens ?? 0);
            const completionTokens = Number(event.data?.completionTokens ?? 0);
            const totalTokens = Number(event.data?.totalTokens ?? promptTokens + completionTokens);
            const prev = run.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
            return {
              ...run,
              usage: {
                promptTokens: prev.promptTokens + promptTokens,
                completionTokens: prev.completionTokens + completionTokens,
                totalTokens: prev.totalTokens + totalTokens,
              },
            };
          });
        }
      };
      source.onerror = () => {
        setHealthText("事件流已断开，正在重试");
      };
      sourceRef.current = source;
    },
    [closeStream, patchRun],
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
    const incoming = body.runs ?? [];
    setRuns((prev) =>
      incoming.map((run) => {
        const local = prev.find((item) => item.id === run.id);
        if (
          local &&
          isActiveRunStatus(local.status) &&
          !isActiveRunStatus(run.status) &&
          (sendingRef.current || pendingRef.current)
        ) {
          return { ...run, status: local.status };
        }
        return run;
      }),
    );
    setCurrentRun((run) => {
      if (!run) return run;
      const fresh = incoming.find((item) => item.id === run.id);
      if (!fresh) return run;
      if (isActiveRunStatus(run.status) && !isActiveRunStatus(fresh.status) && (sendingRef.current || pendingRef.current)) {
        return { ...run, ...fresh, status: run.status };
      }
      return { ...run, ...fresh };
    });
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
    setImages([]);
    setFilesOpen(false);
    setDiffOpen(false);
    setDiffStat("");
    setDiffPatch("");
    setDiffError("");
    setSending(false);
    setStopping(false);
    setPendingTurn(null);
    setEnvId("");
    setBuildId("");
    history.replaceState(null, "", "/");
  }, [closeStream]);

  const openRun = useCallback(
    async (id: string) => {
      const runRes = await api(tokenRef.current, `/v1/runs/${id}`);
      if (!runRes.ok) return false;
      const run = await readJson<Run>(runRes);
      setRunId(run.id);
      setCurrentRun(run);
      setStopping(false);
      setSending(false);
      if (!keepPendingRef.current) setPendingTurn(null);
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
      return true;
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
    if (!text && images.length === 0) return;
    if (isComposerClosed(currentRun?.status)) return;
    if (
      isTurnBusy({
        sending: sendingRef.current,
        stopping,
        pending: Boolean(pendingRef.current),
        status: currentRun?.status,
        messages: snapshot.messages,
      })
    ) {
      return;
    }
    const attached = images;
    const previousStatus = currentRun?.status;
    const pending: PendingUser = {
      id: `pending-${Date.now()}`,
      text: text || "（图片）",
      images: attached.length ? attached : undefined,
      createdAt: new Date().toISOString(),
    };
    setSending(true);
    setPendingTurn(pending);
    setPrompt("");
    setImages([]);
    if (runId && !isActiveRunStatus(currentRun?.status)) {
      patchRun(runId, (run) => ({ ...run, status: "RUNNING" }));
    }
    const repoUrls = repo.trim() ? [repo.trim()] : [];
    const model =
      llm.upstream === "openai" ? "gpt-4o-mini" : /pro/i.test(llm.model ?? "") ? "deepseek-v4-pro" : "deepseek-v4-flash";
    const buildPayload = buildId === "cold" ? { reuseBuild: false } : buildId ? { buildId, reuseBuild: true } : { reuseBuild: true };
    try {
      if (!runId) {
        const created = await readJson<Run & { error?: string }>(
          await api(tokenRef.current, "/v1/runs", {
            method: "POST",
            body: JSON.stringify({
              prompt: text || "（图片）",
              repoUrls,
              source: "web",
              envId: envId || undefined,
              model,
              images: attached.length ? attached : undefined,
              ...buildPayload,
            }),
          }),
        );
        if (created.error) throw new Error(created.error);
        setRuns((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        keepPendingRef.current = true;
        try {
          const opened = await openRun(created.id);
          if (!opened) throw new Error("打开对话失败");
        } finally {
          keepPendingRef.current = false;
        }
        return;
      }
      const follow = await readJson<{ error?: string }>(
        await api(tokenRef.current, `/v1/runs/${runId}/follow-ups`, {
          method: "POST",
          body: JSON.stringify({ text: text || "（图片）", images: attached.length ? attached : undefined }),
        }),
      );
      if (follow.error) throw new Error(follow.error);
    } catch (error) {
      setPendingTurn(null);
      setPrompt(text);
      setImages(attached);
      if (runId && previousStatus) {
        patchRun(runId, (run) => ({ ...run, status: previousStatus }));
      }
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
    } finally {
      setSending(false);
    }
  }, [buildId, currentRun?.status, envId, images, llm.model, llm.upstream, openRun, patchRun, prompt, repo, runId, snapshot.messages, stopping]);

  const stopTurn = useCallback(() => {
    if (!runId) return;
    setStopping(true);
    void api(tokenRef.current, `/v1/runs/${runId}/abort`, { method: "POST" }).catch(() => {
      setStopping(false);
    });
  }, [runId]);

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

  useEffect(() => {
    if (pendingTurn && pendingUserArrived(snapshot.messages, pendingTurn)) {
      setPendingTurn(null);
    }
  }, [pendingTurn, snapshot.messages]);

  useEffect(() => {
    if (filesOpen || diffOpen || settingsOpen) {
      document.getElementById("workspace-drawer")?.scrollIntoView({ block: "nearest" });
    }
  }, [filesOpen, diffOpen, settingsOpen]);

  const displayMessages = withPendingUser(visibleMessages as TranscriptMessage[], pendingTurn);
  const busy = isTurnBusy({
    sending,
    stopping,
    pending: Boolean(pendingTurn),
    status: currentRun?.status,
    messages: snapshot.messages,
  });
  const archived = isComposerClosed(currentRun?.status);
  const activity = activityLabel({
    sending,
    stopping,
    status: currentRun?.status,
    streaming: isAssistantStreaming(snapshot.messages),
    runningTool: runningToolName(snapshot.messages),
  });
  const statusView = turnStatusLabel({ sending, stopping, status: currentRun?.status });
  const pr = currentRun?.pullRequests?.[0] as PullRequest | undefined;
  const currentSlot = currentRun?.vmSlotId || vms.slots.find((slot) => slot.runId === runId)?.id || null;
  const vmHint = !vms.total && vms.slots.length === 0
    ? "未启用 VM 槽。"
    : currentSlot
      ? `当前对话占用 ${slotLabel(currentSlot)}（${currentSlot}，${vms.backend === "loop" ? "loop 挂载" : vms.backend}）`
      : Math.max(0, (vms.total || vms.slots.length) - vms.busy) > 0
        ? `${Math.max(0, (vms.total || vms.slots.length) - vms.busy)}/${vms.total || vms.slots.length} 个 VM 空闲，发送后占用其中一个（${vms.backend === "loop" ? "loop 挂载" : vms.backend}）。`
        : `${vms.total || vms.slots.length} 个 VM 都在忙。新对话会排队，有空闲槽再自动开始。`;

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
              <span className="status" id="status" data-state={statusView.state} data-busy={busy ? "true" : "false"}>
                {busy ? <span className="pulse-dot" aria-hidden="true" /> : null}
                {statusView.label}
              </span>
              {formatUsage(currentRun?.usage) ? (
                <span className="vm-badge" id="usage-badge">
                  {formatUsage(currentRun?.usage)}
                </span>
              ) : null}
              <button
                className="ghost"
                id="toggle-files"
                type="button"
                hidden={!runId}
                aria-expanded={filesOpen}
                onClick={() => {
                  const next = !filesOpen;
                  setFilesOpen(next);
                  if (next) {
                    setDiffOpen(false);
                    setSettingsOpen(false);
                  }
                }}
              >
                {filesOpen ? "收起文件" : "文件树"}
              </button>
              <button
                className="ghost"
                id="toggle-diff"
                type="button"
                hidden={!runId}
                aria-expanded={diffOpen}
                onClick={() => {
                  const next = !diffOpen;
                  setDiffOpen(next);
                  setFilesOpen(false);
                  setSettingsOpen(false);
                  if (next && runId) {
                    setDiffLoading(true);
                    setDiffError("");
                    void (async () => {
                      const response = await api(token, `/v1/runs/${runId}/diff`);
                      const body = await readJson<{ stat?: string; patch?: string; error?: string }>(response);
                      if (!response.ok) throw new Error(body.error || "读取 diff 失败");
                      setDiffStat(body.stat ?? "");
                      setDiffPatch(body.patch ?? "");
                    })()
                      .catch((error) => setDiffError(error instanceof Error ? error.message : "读取 diff 失败"))
                      .finally(() => setDiffLoading(false));
                  }
                }}
              >
                {diffOpen ? "收起 Diff" : "Diff"}
              </button>
              <button
                className="ghost"
                id="archive-run"
                type="button"
                hidden={!runId || currentRun?.status === "ARCHIVED"}
                onClick={() => {
                  if (!runId || !window.confirm("归档后会释放 VM。确定？")) return;
                  void (async () => {
                    const archived = await readJson<Run & { error?: string }>(
                      await api(token, `/v1/runs/${runId}/archive`, { method: "POST" }),
                    );
                    if (archived.error) throw new Error(archived.error);
                    setCurrentRun(archived);
                    setRuns((prev) => prev.map((item) => (item.id === archived.id ? { ...item, ...archived } : item)));
                  })().catch((error) => {
                    setEvents((prev) => [
                      ...prev,
                      {
                        id: `err-${Date.now()}`,
                        runId,
                        createdAt: new Date().toISOString(),
                        category: "agent_run",
                        level: "error",
                        kind: "run.error",
                        title: error instanceof Error ? error.message : "归档失败",
                      },
                    ]);
                  });
                }}
              >
                归档
              </button>
              <button
                className="ghost"
                id="toggle-settings"
                type="button"
                aria-expanded={settingsOpen}
                onClick={() => {
                  const next = !settingsOpen;
                  setSettingsOpen(next);
                  if (next) {
                    setFilesOpen(false);
                    setDiffOpen(false);
                  }
                }}
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
            </div>
          </header>
          {filesOpen || diffOpen || settingsOpen ? (
            <aside className="workspace-drawer" id="workspace-drawer" role="dialog" aria-label={settingsOpen ? "设置" : filesOpen ? "文件树" : "Diff"}>
              <div className="workspace-drawer-bar">
                <strong>{settingsOpen ? "设置" : filesOpen ? "文件树" : "Diff"}</strong>
                <button
                  type="button"
                  className="ghost"
                  id="close-drawer"
                  onClick={() => {
                    setFilesOpen(false);
                    setDiffOpen(false);
                    setSettingsOpen(false);
                  }}
                >
                  关闭
                </button>
              </div>
              {settingsOpen ? (
                <SettingsPanel
                  repo={repo}
                  envId={envId}
                  buildId={buildId}
                  environments={environments}
                  builds={builds}
                  llm={llm}
                  llmKey={llmKey}
                  onRepo={setRepo}
                  onEnv={setEnvId}
                  onBuild={setBuildId}
                  onLlmUpstream={(value) =>
                    setLlm((prev) => ({
                      ...prev,
                      upstream: value,
                      model: value === "openai" ? "gpt-4o-mini" : /pro/i.test(prev.model ?? "") ? "deepseek-v4-pro" : "deepseek-v4-flash",
                    }))
                  }
                  onLlmModel={(value) => setLlm((prev) => ({ ...prev, model: value }))}
                  onLlmKey={setLlmKey}
                  onSaveLlm={() => {
              void (async () => {
                if (!llmKey && !llm.configured) return;
                const payload: Record<string, string> = {
                  upstream: llm.upstream || "deepseek",
                  model:
                    llm.upstream === "openai"
                      ? "gpt-4o-mini"
                      : /pro/i.test(llm.model ?? "")
                        ? "deepseek-v4-pro"
                        : "deepseek-v4-flash",
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
                />
              ) : null}
              <FileTree token={token} runId={runId} open={filesOpen} />
              <DiffPanel open={diffOpen} loading={diffLoading} error={diffError} stat={diffStat} patch={diffPatch} />
            </aside>
          ) : null}
          <div className="workspace-col">
            <Transcript
              messages={displayMessages}
              remaining={remaining}
              empty={displayMessages.length === 0}
              busy={busy}
              activity={activity}
              onLoadOlder={loadOlder}
            />
          </div>
          <Composer
            prompt={prompt}
            images={images}
            vmHint={vmHint}
            busy={busy}
            stopping={stopping}
            archived={archived}
            canStop={Boolean(runId)}
            activity={activity}
            onPrompt={setPrompt}
            onImages={setImages}
            onSend={() => void sendMessage()}
            onStop={stopTurn}
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

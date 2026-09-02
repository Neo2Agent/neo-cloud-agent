/**
 * Vite :5175 visual lab. Island chrome + the same /v1 client as Expo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { transcriptBodyNeeded, transcriptGroups } from "@neo-cloud-agent/contracts/transcript";
import type { Automation } from "@neo-cloud-agent/contracts/automation";
import type { Environment } from "@neo-cloud-agent/contracts/environment";
import type { TranscriptMessage, TranscriptTool } from "@neo-cloud-agent/contracts/events";
import type { Desk } from "@neo-cloud-agent/contracts/desk";
import type { Expert, ExpertTeam } from "@neo-cloud-agent/contracts/expert";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { MobileApiError, MobileClient } from "../api/client";
import { sharedWebCredentials, type CredentialStore } from "../api/credentials";
import { nextEnvId } from "../api/shell";
import { detectMobileSource, parseMobileScreen } from "../api/source";
import { schedulePreset, type ScheduleKind } from "../automations";
import { cloudRunRequest } from "../create-run";
import { avatarLetter, chatModelShort, resolveChatModel, toolArgPreview, toolBodyText, toolDisplayName } from "../format";
import { chatStatusText, composerGate } from "../session";
import {
  appendPendingUser,
  generationStarted,
  hasVisibleTranscript,
  isActiveRunStatus,
  isStartupWhisper,
  mergeUnresolvedPending,
  pendingUserArrived,
  pendingUserMessage,
  sendFailureMessage,
  shouldRefreshTranscript,
  shouldReplaceLiveTranscript,
  shouldShowThinking,
  thinkingHint,
  withPendingUser,
  withQueuedNotice,
} from "../turn";
import { attachRunStream } from "../transcript-live";
import { AutomationsPage } from "./AutomationsPage";
import { startAppVoice } from "../start-voice";
import { IslandComposer, IslandDrawer, IslandHome, IslandLogin } from "./chrome";
import { ExpertsPage } from "./ExpertsPage";
import { InvitePage, ProjectsPage } from "./ProjectsPage";
import { IslandTag } from "./island";

function hashScreen() {
  return parseMobileScreen(location.hash || location.href);
}

function ToolRow({ tool }: { tool: TranscriptTool }) {
  const running = tool.status === "running";
  const [open, setOpen] = useState(running);
  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);
  const preview = toolArgPreview(tool.args);
  const body = toolBodyText(tool);
  return (
    <button
      type="button"
      className={`tool${tool.isError ? " err" : running ? " run" : ""}${open ? " is-open" : ""}`}
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
    >
      <span className="tool-head">
        <b>{running ? "…" : tool.isError ? "✗" : "✓"} {toolDisplayName(tool)}</b>
        <small>{open ? "收起" : "展开"}</small>
      </span>
      {preview ? <span className="cmd">{preview}</span> : null}
      {open ? <pre className="tool-out">{body || "没有输出"}</pre> : null}
    </button>
  );
}

export function App({ store = sharedWebCredentials() }: { store?: CredentialStore }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [neoAvatar, setNeoAvatar] = useState<string | null>(null);
  const [authError, setAuthError] = useState("");
  const [pageError, setPageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [route, setRoute] = useState(hashScreen);
  const [runs, setRuns] = useState<Run[]>([]);
  const [envId, setEnvId] = useState("");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [current, setCurrent] = useState<Run | null>(null);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [experts, setExperts] = useState<Expert[]>([]);
  const [teams, setTeams] = useState<ExpertTeam[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [inviteInfo, setInviteInfo] = useState<{ projectName: string; status: string }>({ projectName: "", status: "" });
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [pendingTurn, setPendingTurn] = useState<TranscriptMessage | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expertId, setExpertId] = useState("");
  const [expertName, setExpertName] = useState("");
  const lastEventId = useRef<string | null>(null);
  const lastSseAt = useRef(0);
  const statusRef = useRef<string | null | undefined>(null);
  const stopStream = useRef<(() => void) | null>(null);
  const liveSse = useRef(false);
  const openRunId = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  statusRef.current = current?.status;
  const source = useMemo(() => detectMobileSource(navigator.userAgent), []);
  const client = useMemo(() => new MobileClient(apiUrl, token), [apiUrl, token]);

  const persistToken = useCallback(
    async (next: string) => {
      setToken(next);
      if (next) await store.setToken(next);
      else await store.clearToken();
    },
    [store],
  );

  useEffect(() => {
    void (async () => {
      setToken(await store.getToken());
      setApiUrl(await store.getApiUrl());
      setReady(true);
    })();
  }, [store]);

  useEffect(() => {
    const sync = () => setRoute(hashScreen());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const go = (path: string) => {
    location.hash = path;
  };

  const refreshList = useCallback(async () => {
    if (!token) return;
    const [listed, environments, settings, deskList, expertList, teamList, projectList, autoList, me] = await Promise.all([
      client.listRuns(),
      client.listEnvironments().catch(() => ({ environments: [] as Environment[] })),
      client.llmSettings().catch(() => null),
      client.listDesks().catch(() => ({ desks: [] })),
      client.listExperts().catch(() => ({ experts: [] })),
      client.listExpertTeams().catch(() => ({ teams: [] })),
      client.listProjects().catch(() => ({ projects: [] })),
      client.listAutomations().catch(() => ({ automations: [] })),
      client.me().catch(() => ({ user: null })),
    ]);
    setRuns(listed.runs);
    setDesks(deskList.desks);
    setExperts(expertList.experts);
    setTeams(teamList.teams);
    setProjects(projectList.projects);
    setAutomations(autoList.automations);
    if (me.user) {
      setUserId(me.user.id);
      setEmail(me.user.email);
      setUserAvatar(me.user.avatar ?? null);
      setNeoAvatar(me.user.neoAvatar ?? null);
    }
    if (settings?.model) setModel(resolveChatModel(settings.model));
    setEnvId((current) => nextEnvId(current, environments.environments));
  }, [client, token]);

  const persistTokenRef = useRef(persistToken);
  persistTokenRef.current = persistToken;

  useEffect(() => {
    if (!ready || !token) return;
    void refreshList().catch((error) => {
      if (error instanceof MobileApiError && error.status === 401) void persistTokenRef.current("");
    });
  }, [ready, token, refreshList]);

  useEffect(() => {
    if (!token || route.screen !== "invite" || !route.inviteToken) return;
    void client
      .getInvite(route.inviteToken)
      .then(setInviteInfo)
      .catch(() => setInviteInfo({ projectName: "", status: "" }));
  }, [client, route.inviteToken, route.screen, token]);

  useEffect(() => {
    if (!token || route.screen !== "chat") return;
    const timer = window.setInterval(() => {
      void client.listDesks().then((next) => setDesks(next.desks)).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [client, route.screen, token]);

  useEffect(() => {
    if (!token || route.screen !== "chat" || !current?.id) return;
    const id = current.id;
    const tick = async () => {
      if (!shouldRefreshTranscript({ lastSseAt: lastSseAt.current, status: statusRef.current })) return;
      try {
        const run = await client.getRun(id);
        setCurrent(run);
        if (
          !transcriptBodyNeeded({ appliedEventId: lastEventId.current, runLastEventId: run.lastEventId })
        ) {
          setMessages((prev) => withQueuedNotice(prev, run.status));
          return;
        }
        const transcript = await client.transcript(id);
        if (
          (transcript.snapshot.lastEventId && transcript.snapshot.lastEventId === lastEventId.current) ||
          !shouldReplaceLiveTranscript({ liveSse: liveSse.current, lastSseAt: lastSseAt.current })
        ) {
          setMessages((prev) => withQueuedNotice(prev, run.status));
          return;
        }
        lastEventId.current = transcript.snapshot.lastEventId;
        setMessages((prev) =>
          mergeUnresolvedPending(withQueuedNotice(transcript.snapshot.messages, run.status), prev),
        );
      } catch {
        // keep the last painted transcript
      }
    };
    const timer = window.setInterval(() => void tick(), 2500);
    void tick();
    return () => window.clearInterval(timer);
  }, [client, current?.id, route.screen, token]);

  const closeStream = useCallback(() => {
    stopStream.current?.();
    stopStream.current = null;
    liveSse.current = false;
  }, []);

  const listen = useCallback(
    (id: string, after?: string | null) => {
      closeStream();
      liveSse.current = true;
      stopStream.current = attachRunStream(client, id, after ?? lastEventId.current, {
        onMessages: setMessages,
        onEventId: (eventId) => {
          lastEventId.current = eventId;
          lastSseAt.current = Date.now();
        },
        onStatus: (status) => {
          setCurrent((run) => (run && run.id === id ? { ...run, status: status as Run["status"] } : run));
        },
      });
    },
    [client, closeStream],
  );

  const openRun = useCallback(
    async (id: string, opts?: { keepPending?: boolean }) => {
      const previousId = openRunId.current;
      const [run, transcript] = await Promise.all([client.getRun(id), client.transcript(id)]);
      setCurrent(run);
      openRunId.current = run.id;
      if (previousId !== id && !opts?.keepPending) setPendingTurn(null);
      const loaded = withQueuedNotice(transcript.snapshot.messages, run.status);
      setMessages((prev) =>
        previousId === id || opts?.keepPending ? mergeUnresolvedPending(loaded, prev) : loaded,
      );
      lastEventId.current = transcript.snapshot.lastEventId;
      lastSseAt.current = Date.now();
      listen(id, transcript.snapshot.lastEventId);
      setSidebarOpen(false);
      go(`/runs/${id}`);
    },
    [client, listen],
  );

  useEffect(() => {
    if (route.screen === "chat" && route.runId && token && current?.id !== route.runId) {
      void openRun(route.runId).catch(() => go("/"));
    }
    if (route.screen !== "chat") closeStream();
  }, [closeStream, current?.id, openRun, route.runId, route.screen, token]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, pendingTurn]);

  useEffect(() => {
    if (pendingTurn && pendingUserArrived(messages, pendingTurn)) {
      setPendingTurn(null);
    }
  }, [messages, pendingTurn]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) closeStream();
      else if (route.screen === "chat" && route.runId) listen(route.runId, lastEventId.current);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [closeStream, listen, route.runId, route.screen]);

  const loginWith = async (nextEmail: string, nextPassword: string) => {
    setBusy(true);
    setAuthError("");
    try {
      const session = await new MobileClient(apiUrl, "").login(nextEmail.trim(), nextPassword);
      await persistToken(session.token);
      setEmail(session.user.email ?? nextEmail);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const registerWith = async (nextUsername: string, nextPhone: string, nextPassword: string) => {
    setBusy(true);
    setAuthError("");
    try {
      const session = await new MobileClient(apiUrl, "").register({
        username: nextUsername.trim(),
        phone: nextPhone.trim(),
        password: nextPassword,
      });
      if (session.pending || !session.token) {
        setAuthError(session.message || "注册成功，请等待管理员审核后再登录");
        return;
      }
      await persistToken(session.token);
      setEmail(session.user.email ?? nextUsername);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "注册失败");
    } finally {
      setBusy(false);
    }
  };

  const resetHome = () => {
    setCurrent(null);
    openRunId.current = null;
    setPendingTurn(null);
    setMessages([]);
    setPrompt("");
    go("/");
  };

  const send = async () => {
    const text = prompt.trim();
    if (!text || sending) return;
    if (composerGate(current, desks).locked) return;
    const pending = pendingUserMessage(text);
    setSending(true);
    setPrompt("");
    setPendingTurn(pending);
    setMessages((prev) => appendPendingUser(prev, pending));
    try {
      if (!current) {
        const created = await client.createRun(
          cloudRunRequest({
            prompt: text,
            source,
            envId,
            model: resolveChatModel(model),
            expertId,
            projectId: projectId ?? undefined,
          }),
        );
        setRuns((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        await openRun(created.id, { keepPending: true });
        return;
      }
      await client.followUp(current.id, { text });
    } catch (error) {
      setPrompt(text);
      setPendingTurn(null);
      setMessages((prev) => [
        ...prev.filter((item) => item.id !== pending.id),
        sendFailureMessage(error instanceof Error ? error.message : "发送失败"),
      ]);
    } finally {
      setSending(false);
    }
  };

  if (!ready) return <div className="login-shell"><p>正在进入…</p></div>;

  if (!token) {
    return (
      <IslandLogin
        busy={busy}
        error={authError}
        onLogin={(nextEmail, nextPassword) => void loginWith(nextEmail, nextPassword)}
        onRegister={(nextUsername, nextPhone, nextPassword) => void registerWith(nextUsername, nextPhone, nextPassword)}
      />
    );
  }

  if (route.screen === "settings") {
    return (
      <div className="app">
        <header className="topbar">
          <button className="icon-btn" type="button" onClick={() => go("/")}>←</button>
          <h1>设置</h1>
        </header>
        <div className="page-body">
          <div className="island-card settings-card">
            <button
              className="island-btn island-btn-primary"
              type="button"
              onClick={() => {
                void client.logout().catch(() => undefined);
                void persistToken("");
                go("/");
              }}
            >
              退出登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (route.screen === "automations") {
    return (
      <AutomationsPage
        items={automations}
        error={pageError}
        onBack={() => go("/")}
        onCreate={async (text, preset: ScheduleKind) => {
          setPageError("");
          try {
            await client.createAutomation({ prompt: text, schedule: schedulePreset(preset) });
            await refreshList();
          } catch (error) {
            setPageError(error instanceof Error ? error.message : "创建失败");
            throw error;
          }
        }}
        onToggle={(item) => {
          void client.updateAutomation(item.id, { enabled: !item.enabled }).then(() => refreshList()).catch((error) => {
            setPageError(error instanceof Error ? error.message : "更新失败");
          });
        }}
        onOpenRun={(id) => void openRun(id)}
      />
    );
  }

  if (route.screen === "experts") {
    return (
      <ExpertsPage
        experts={experts}
        teams={teams}
        userId={userId}
        error={pageError}
        onBack={() => go("/")}
        onSummon={(pick) => {
          setExpertId(pick.expertId ?? "");
          setExpertName(pick.name);
          go("/");
        }}
        onSave={async (draft, id) => {
          setPageError("");
          try {
            if (id) await client.updateExpert(id, draft);
            else await client.createExpert({ ...draft, visibility: "user" });
            await refreshList();
          } catch (error) {
            setPageError(error instanceof Error ? error.message : "保存失败");
            throw error;
          }
        }}
      />
    );
  }

  if (route.screen === "projects") {
    return (
      <ProjectsPage
        items={projects}
        runs={runs}
        selectedId={projectId && projects.some((item) => item.id === projectId) ? projectId : null}
        error={pageError}
        onBack={() => go("/")}
        onSelect={setProjectId}
        onCreate={async (name, instruction) => {
          setPageError("");
          const created = await client.createProject({ name, instruction, invitePolicy: "approve" });
          await refreshList();
          setProjectId(created.id);
        }}
        onOpenRun={(id) => void openRun(id)}
        onNewInProject={() => {
          setCurrent(null);
          setPendingTurn(null);
          setMessages([]);
          go("/");
        }}
      />
    );
  }

  if (route.screen === "invite" && route.inviteToken) {
    return (
      <InvitePage
        projectName={inviteInfo.projectName}
        status={inviteInfo.status}
        busy={busy}
        error={pageError}
        onBack={() => go("/projects")}
        onJoin={() => {
          setBusy(true);
          setPageError("");
          void client
            .acceptInvite(route.inviteToken!)
            .then((project) => {
              const invite = project.invites.find((item) => item.token === route.inviteToken);
              if (invite?.status === "pending") {
                setInviteInfo({ projectName: project.name, status: "pending" });
                return;
              }
              setProjectId(project.id);
              go("/projects");
            })
            .catch((error) => setPageError(error instanceof Error ? error.message : "加入失败"))
            .finally(() => setBusy(false));
        }}
      />
    );
  }

  const gate = composerGate(current, desks);
  const composer = (
    <IslandComposer
      prompt={prompt}
      locked={gate.locked}
      placeholder={gate.archived ? "对话已归档。" : gate.hint || "说说你要做什么"}
      sending={sending}
      canStop={Boolean(current) && gate.running}
      model={model}
      onModel={setModel}
      onPrompt={setPrompt}
      onSend={() => void send()}
      onStop={current ? () => void client.abort(current.id) : undefined}
      startVoice={(onPreview, onError, onEnded) => startAppVoice(client, onPreview, onError, onEnded)}
    />
  );
  const drawer = (
    <IslandDrawer
      open={sidebarOpen}
      runs={runs}
      userEmail={email}
      health={`在线 · ${chatModelShort(model)}`}
      onClose={() => setSidebarOpen(false)}
      onNew={resetHome}
      onOpenRun={(id) => void openRun(id)}
      onOpenNav={(id) => {
        setSidebarOpen(false);
        go(id === "home" ? "/" : `/${id}`);
      }}
    />
  );

  const visible = withPendingUser(messages, pendingTurn);
  const turnBusy = Boolean(sending || pendingTurn || (current && isActiveRunStatus(current.status)));
  const thinking = shouldShowThinking(turnBusy, visible)
    ? thinkingHint({
        status: current?.status,
        loop: current?.executionTarget?.loop,
        remoteControl: current?.executionTarget?.remoteControl,
      })
    : null;
  if (route.screen === "chat" || sending || pendingTurn || visible.length > 0) {
    return (
      <div className="app">
        <header className="topbar">
          <button className="icon-btn" type="button" aria-label="打开任务" onClick={() => setSidebarOpen(true)}>☰</button>
          <span className={turnBusy ? "status-pill is-busy" : "status-pill"}>{chatStatusText(current, desks)}</span>
          {current ? <IslandTag>{current.executionTarget?.remoteControl ? "remote" : "cloud"}</IslandTag> : null}
        </header>
        <div className="transcript" ref={transcriptRef}>
          {visible.length === 0 ? <p className="empty">还没有消息。</p> : null}
          {visible.map((message) => {
            if (isStartupWhisper(message)) {
              if (generationStarted(visible) || thinking) return null;
              return (
                <p key={message.id} className="whisper">
                  {message.text}
                </p>
              );
            }
            if (!hasVisibleTranscript(message)) return null;
            return (
            <div key={message.id} className={`msg-row ${message.role}`}>
              {message.role === "user" && userAvatar ? (
                <img className="avatar user" src={userAvatar} alt="" />
              ) : message.role !== "user" && neoAvatar ? (
                <img className="avatar neo" src={neoAvatar} alt="" />
              ) : (
                <span className={`avatar ${message.role === "user" ? "user" : "neo"}`} aria-hidden="true">
                  {message.role === "user" ? avatarLetter(email) : "N"}
                </span>
              )}
              <div className="msg-col">
                {transcriptGroups(message).map((group, index) =>
                  group.type === "text" ? (
                    <article key={`${message.id}-t${index}`} className={`bubble ${message.role}`}>
                      <p>{group.text}</p>
                    </article>
                  ) : (
                    <div key={`${message.id}-g${index}`} className="tool-stack">
                      {group.tools.map((tool) => (
                        <ToolRow key={tool.id ?? tool.name} tool={tool} />
                      ))}
                    </div>
                  ),
                )}
              </div>
            </div>
            );
          })}
          {thinking ? (
            <div className="msg-row agent">
              {neoAvatar ? (
                <img className="avatar neo" src={neoAvatar} alt="" />
              ) : (
                <span className="avatar neo" aria-hidden="true">N</span>
              )}
              <div className="think-line">
                <span className="think-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>{thinking}</span>
              </div>
            </div>
          ) : null}
        </div>
        {composer}
        {drawer}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" type="button" aria-label="打开任务" onClick={() => setSidebarOpen(true)}>☰</button>
      </header>
      <IslandHome expertName={expertName} />
      {composer}
      {drawer}
    </div>
  );
}

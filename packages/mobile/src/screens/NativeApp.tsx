import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { Automation } from "@neo-cloud-agent/contracts/automation";
import type { Desk } from "@neo-cloud-agent/contracts/desk";
import type { Expert, ExpertTeam } from "@neo-cloud-agent/contracts/expert";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { MobileApiError, MobileClient } from "../api/client";
import type { CredentialStore } from "../api/credentials";
import { nextEnvId } from "../api/shell";
import { detectMobileSource } from "../api/source";
import { schedulePreset } from "../automations";
import { cloudRunRequest } from "../create-run";
import { chatModelShort, resolveChatModel } from "../format";
import { listenNeoDeepLinks } from "../native/linking";
import { attachForegroundPushPolicy, listenNotificationOpen, registerExpoPushDevice } from "../native/push";
import { DEFAULT_API_URL } from "../place";
import { chatStatusText, composerGate } from "../session";
import {
  appendPendingUser,
  mergeUnresolvedPending,
  pendingUserArrived,
  isActiveRunStatus,
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
import { ChatScreen } from "./ChatScreen";
import { startNativeVoice } from "../native/speech";
import { Composer } from "./Composer";
import { Drawer } from "./Drawer";
import { AutomationsScreen, ExpertsScreen, InviteScreen, ProjectsScreen } from "./FeatureScreens";
import { HomeScreen } from "./HomeScreen";
import { LoginScreen } from "./LoginScreen";
import { Screen } from "./Screen";
import { SettingsScreen } from "./SettingsScreen";
import { colors } from "./theme";

type Screen = "home" | "chat" | "settings" | "experts" | "projects" | "automations" | "invite";

export function NativeApp({ store }: { store: CredentialStore }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [email, setEmail] = useState("");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [neoAvatar, setNeoAvatar] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
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
  const [inviteToken, setInviteToken] = useState("");
  const [inviteInfo, setInviteInfo] = useState({ projectName: "", status: "" });
  const [pageError, setPageError] = useState("");
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [pendingTurn, setPendingTurn] = useState<TranscriptMessage | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expertId, setExpertId] = useState("");
  const [expertName, setExpertName] = useState("");
  const lastEventId = useRef<string | null>(null);
  const lastSseAt = useRef(0);
  const statusRef = useRef<string | null | undefined>(null);
  const stopStream = useRef<(() => void) | null>(null);
  const liveSse = useRef(false);
  const openRunId = useRef<string | null>(null);
  const foreground = useRef(true);
  statusRef.current = current?.status;
  const source = useMemo(() => detectMobileSource(Platform.OS === "ios" ? "iPhone" : "Android"), []);
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
      setApiUrl((await store.getApiUrl()) || DEFAULT_API_URL);
      setReady(true);
    })();
  }, [store]);

  const refreshList = useCallback(async () => {
    if (!token) return;
    const [listed, environments, settings, deskList, expertList, teamList, projectList, autoList, me] = await Promise.all([
      client.listRuns(),
      client.listEnvironments().catch(() => ({ environments: [] })),
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
    void registerExpoPushDevice((input) => client.registerDevice(input), Platform.OS === "ios" ? "iPhone" : "Android");
  }, [ready, token, refreshList, client]);

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
      setDrawerOpen(false);
      setScreen("chat");
    },
    [client, listen],
  );

  useEffect(() => {
    if (screen !== "chat" || !current?.id) return;
    const id = current.id;
    const tick = async () => {
      void client.listDesks().then((next) => setDesks(next.desks)).catch(() => undefined);
      if (!shouldRefreshTranscript({ lastSseAt: lastSseAt.current, status: statusRef.current })) {
        void client.getRun(id).then(setCurrent).catch(() => undefined);
        return;
      }
      try {
        const [run, transcript] = await Promise.all([client.getRun(id), client.transcript(id)]);
        setCurrent(run);
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
    const timer = setInterval(() => void tick(), 2500);
    void tick();
    return () => clearInterval(timer);
  }, [client, current?.id, screen]);

  useEffect(() => {
    if (screen !== "chat") closeStream();
  }, [closeStream, screen]);

  useEffect(() => {
    if (!token || screen !== "invite" || !inviteToken) return;
    void client.getInvite(inviteToken).then(setInviteInfo).catch(() => setInviteInfo({ projectName: "", status: "" }));
  }, [client, inviteToken, screen, token]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      foreground.current = state === "active";
      if (state !== "active") closeStream();
      else if (screen === "chat" && current) listen(current.id, lastEventId.current);
    });
    return () => sub.remove();
  }, [closeStream, current, listen, screen]);

  useEffect(() => {
    let stopLink: (() => void) | undefined;
    let stopPush: (() => void) | undefined;
    let stopBanner: (() => void) | undefined;
    void listenNeoDeepLinks(
      (id) => void openRun(id).catch(() => undefined),
      (token) => {
        setInviteToken(token);
        setScreen("invite");
      },
    ).then((stop) => {
      stopLink = stop;
    });
    void listenNotificationOpen((id) => void openRun(id).catch(() => undefined)).then((stop) => {
      stopPush = stop;
    });
    void attachForegroundPushPolicy({
      appInForeground: () => foreground.current,
      liveSse: () => liveSse.current,
      openRunId: () => openRunId.current,
    }).then((stop) => {
      stopBanner = stop;
    });
    return () => {
      stopLink?.();
      stopPush?.();
      stopBanner?.();
    };
  }, [openRun]);

  const login = async () => {
    setBusy(true);
    setAuthError("");
    try {
      await store.setApiUrl(DEFAULT_API_URL);
      setApiUrl(DEFAULT_API_URL);
      const session = await new MobileClient(DEFAULT_API_URL, "").login(email.trim(), password);
      await persistToken(session.token);
      setEmail(session.user.email ?? email);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (pendingTurn && pendingUserArrived(messages, pendingTurn)) {
      setPendingTurn(null);
    }
  }, [messages, pendingTurn]);

  const resetHome = () => {
    closeStream();
    setCurrent(null);
    openRunId.current = null;
    setPendingTurn(null);
    setMessages([]);
    setPrompt("");
    setExpertId("");
    setExpertName("");
    setDrawerOpen(false);
    setScreen("home");
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
    setScreen("chat");
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

  if (!ready) {
    return <Screen />;
  }

  if (!token) {
    return (
      <LoginScreen
        busy={busy}
        error={authError}
        email={email}
        password={password}
        onEmail={setEmail}
        onPassword={setPassword}
        onSubmit={() => void login()}
      />
    );
  }

  if (screen === "settings") {
    return (
      <SettingsScreen
        onBack={() => setScreen("home")}
        onLogout={() => {
          void client.logout().catch(() => undefined);
          void persistToken("");
          setUserAvatar(null);
          setNeoAvatar(null);
          resetHome();
        }}
      />
    );
  }

  if (screen === "automations") {
    return (
      <AutomationsScreen
        items={automations}
        error={pageError}
        onBack={() => setScreen("home")}
        onCreate={async (text, preset) => {
          await client.createAutomation({ prompt: text, schedule: schedulePreset(preset) });
          await refreshList();
        }}
        onToggle={(item) => {
          void client.updateAutomation(item.id, { enabled: !item.enabled }).then(() => refreshList());
        }}
        onOpenRun={(id) => void openRun(id)}
      />
    );
  }

  if (screen === "experts") {
    return (
      <ExpertsScreen
        experts={experts}
        teams={teams}
        error={pageError}
        onBack={() => setScreen("home")}
        onSummon={(pick) => {
          setExpertId(pick.expertId ?? "");
          setExpertName(pick.name);
          setScreen("home");
        }}
        onCreate={async (name, description, persona) => {
          await client.createExpert({ name, description, persona, methodology: "", deliverables: "", visibility: "user" });
          await refreshList();
        }}
      />
    );
  }

  if (screen === "projects") {
    return (
      <ProjectsScreen
        items={projects}
        runs={runs}
        selectedId={projectId}
        error={pageError}
        onBack={() => setScreen("home")}
        onSelect={setProjectId}
        onCreate={async (name, instruction) => {
          const created = await client.createProject({ name, instruction, invitePolicy: "approve" });
          await refreshList();
          setProjectId(created.id);
        }}
        onOpenRun={(id) => void openRun(id)}
        onNewInProject={() => {
          setCurrent(null);
          setPendingTurn(null);
          setMessages([]);
          setScreen("home");
        }}
      />
    );
  }

  if (screen === "invite") {
    return (
      <InviteScreen
        projectName={inviteInfo.projectName}
        status={inviteInfo.status}
        busy={busy}
        error={pageError}
        onBack={() => setScreen("projects")}
        onJoin={() => {
          setBusy(true);
          void client
            .acceptInvite(inviteToken)
            .then((project) => {
              setProjectId(project.id);
              setScreen("projects");
            })
            .catch((error) => setPageError(error instanceof Error ? error.message : "加入失败"))
            .finally(() => setBusy(false));
        }}
      />
    );
  }

  const gate = composerGate(current, desks);
  const visible = withPendingUser(messages, pendingTurn);
  const turnBusy = Boolean(sending || pendingTurn || (current && isActiveRunStatus(current.status)));
  const thinking = shouldShowThinking(turnBusy, visible)
    ? thinkingHint({
        status: current?.status,
        loop: current?.executionTarget?.loop,
        remoteControl: current?.executionTarget?.remoteControl,
      })
    : null;
  const composer = (
    <Composer
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
      startVoice={(onPreview, onError, onEnded) => startNativeVoice(client, onPreview, onError, onEnded)}
    />
  );

  return (
    <Screen>
      {screen === "chat" ? (
        <ChatScreen
          run={current}
          status={chatStatusText(current, desks)}
          running={turnBusy}
          messages={visible}
          thinking={thinking}
          userEmail={email}
          userAvatar={userAvatar}
          neoAvatar={neoAvatar}
          onOpenDrawer={() => setDrawerOpen(true)}
        />
      ) : (
        <View style={styles.home}>
          <View style={styles.topbar}>
            <Pressable onPress={() => setDrawerOpen(true)} hitSlop={12}>
              <Text style={styles.menu}>☰</Text>
            </Pressable>
          </View>
          <HomeScreen expertName={expertName} />
        </View>
      )}
      {composer}
      <Drawer
        open={drawerOpen}
        runs={runs}
        userEmail={email}
        health={`在线 · ${chatModelShort(model)}`}
        onClose={() => setDrawerOpen(false)}
        onNew={resetHome}
        onOpenRun={(id) => void openRun(id)}
        onOpenNav={(id) => {
          setDrawerOpen(false);
          if (id === "home") setScreen("home");
          else setScreen(id);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  home: { flex: 1 },
  topbar: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  menu: { fontSize: 20, color: colors.ink },
});

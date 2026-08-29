import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyRunEventsToMessages,
  settleTranscriptMessages,
  transcriptGroups,
} from "@neo-cloud-agent/contracts/transcript";
import type { Environment } from "@neo-cloud-agent/contracts/environment";
import type { RunEvent, TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { remoteControlSendLock, type Desk } from "@neo-cloud-agent/contracts/desk";
import type { Expert } from "@neo-cloud-agent/contracts/expert";
import type { PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import { pluginPickerLabel } from "@neo-cloud-agent/contracts/plugin";
import type { Project } from "@neo-cloud-agent/contracts/project";
import { BUNDLED_RECIPES, recipeById } from "@neo-cloud-agent/contracts/recipe";
import type { ExecutionTarget, Run } from "@neo-cloud-agent/contracts/run";
import { BuddyHome, BuddyPlusSheet, buddySkillsFromRecipes, type BuddyPlusAction } from "@neo-cloud-agent/ui";
import { MobileApiError, MobileClient } from "./api/client";
import { webCredentials, type CredentialStore } from "./api/credentials";
import { detectMobileSource, parseMobileScreen } from "./api/source";
import { BuddyComposer } from "./composer";
import { preview, resolveChatModel, STATUS_LABELS, toolArgPreview, toolDisplayName } from "./format";
import { BuddyDrawer, BuddyLogin, CatalogList } from "./shell";
import { applyLiveEvents } from "./stream";
import { isComposerClosed, isTerminalTurnEvent, statusFromEventKind } from "./turn";

function hashScreen() {
  return parseMobileScreen(location.hash || location.href);
}

function firstDeskTarget(desks: Desk[]): ExecutionTarget {
  for (const desk of desks) {
    if (!desk.online || desk.allowRemote !== true) continue;
    const workspace = desk.workspaces?.[0];
    if (workspace) {
      return { loop: "desk", tools: "desk", deskId: desk.id, deskWorkspaceId: workspace.id, remoteControl: true };
    }
  }
  return { loop: "cloud", tools: "cloud" };
}

export function App({ store = webCredentials() }: { store?: CredentialStore }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [email, setEmail] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [route, setRoute] = useState(hashScreen);
  const [runs, setRuns] = useState<Run[]>([]);
  const [, setEnvs] = useState<Environment[]>([]);
  const [envId, setEnvId] = useState("");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [current, setCurrent] = useState<Run | null>(null);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [experts, setExperts] = useState<Expert[]>([]);
  const [plugins, setPlugins] = useState<PluginCatalogItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [targetKind, setTargetKind] = useState<"cloud" | "desk">("cloud");
  const [expertId, setExpertId] = useState("");
  const [pluginId, setPluginId] = useState("");
  const lastEventId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const source = useMemo(() => detectMobileSource(navigator.userAgent), []);
  const client = useMemo(() => new MobileClient(apiUrl, token), [apiUrl, token]);
  const deskDisabled = !desks.some((desk) => desk.online && desk.allowRemote === true && (desk.workspaces?.length ?? 0) > 0);

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
    const [listed, environments, settings, deskList, expertList, pluginList, projectList] = await Promise.all([
      client.listRuns(),
      client.listEnvironments().catch(() => ({ environments: [] })),
      client.llmSettings().catch(() => null),
      client.listDesks().catch(() => ({ desks: [] })),
      client.listExperts().catch(() => ({ experts: [] })),
      client.listPlugins().catch(() => ({ plugins: [] })),
      client.listProjects().catch(() => ({ projects: [] })),
    ]);
    setRuns(listed.runs);
    setEnvs(environments.environments);
    setDesks(deskList.desks);
    setExperts(expertList.experts);
    setPlugins(pluginList.plugins);
    setProjects(projectList.projects);
    if (settings?.model) setModel(resolveChatModel(settings.model));
    if (!envId && environments.environments[0]) setEnvId(environments.environments[0].id);
  }, [client, envId, token]);

  useEffect(() => {
    if (!ready || !token) return;
    void refreshList().catch((error) => {
      if (error instanceof MobileApiError && error.status === 401) void persistToken("");
    });
  }, [ready, token, refreshList, persistToken]);

  useEffect(() => {
    if (!token || route.screen !== "chat") return;
    const timer = window.setInterval(() => {
      void client.listDesks().then((next) => setDesks(next.desks)).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [client, route.screen, token]);

  const closeStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const listen = useCallback(
    (id: string, after?: string | null) => {
      closeStream();
      const controller = new AbortController();
      abortRef.current = controller;
      const pending: RunEvent[] = [];
      let timer = 0;
      const flush = () => {
        timer = 0;
        const batch = applyLiveEvents([], pending.splice(0));
        if (batch.length === 0) return;
        setMessages((prev) => {
          const next = applyRunEventsToMessages(prev, batch);
          return batch.some((event) => isTerminalTurnEvent(event.kind)) ? settleTranscriptMessages(next) : next;
        });
        for (const event of batch) {
          lastEventId.current = event.id;
          const status = statusFromEventKind(event.kind);
          if (status) {
            setCurrent((run) => (run && run.id === id ? { ...run, status: status as Run["status"] } : run));
          }
        }
      };
      void client
        .streamEvents(
          id,
          (event) => {
            pending.push(event);
            if (!timer) timer = window.setTimeout(flush, 16);
          },
          { after: after ?? lastEventId.current, signal: controller.signal },
        )
        .catch(() => {
          if (!controller.signal.aborted) {
            window.setTimeout(() => listen(id, lastEventId.current), 800);
          }
        });
    },
    [client, closeStream],
  );

  const openRun = useCallback(
    async (id: string) => {
      const [run, transcript] = await Promise.all([client.getRun(id), client.transcript(id)]);
      setCurrent(run);
      setMessages(transcript.snapshot.messages);
      lastEventId.current = transcript.snapshot.lastEventId;
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
  }, [messages]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) closeStream();
      else if (route.screen === "chat" && route.runId) listen(route.runId, lastEventId.current);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [closeStream, listen, route.runId, route.screen]);

  const loginWith = async (nextEmail: string, nextPassword: string, nextUrl = apiUrl) => {
    setBusy(true);
    setAuthError("");
    try {
      const next = new MobileClient(nextUrl, "");
      const session = await next.login(nextEmail.trim(), nextPassword);
      await persistToken(session.token);
      setEmail(session.user.email ?? nextEmail);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const resetHome = () => {
    setCurrent(null);
    setMessages([]);
    setPrompt("");
    setMoreOpen(false);
    setPlusOpen(false);
    setExpertId("");
    setPluginId("");
    go("/");
  };

  const send = async () => {
    const text = prompt.trim();
    if (!text || sending) return;
    if (current && remoteControlSendLock(current, desks).locked) return;
    setSending(true);
    setPrompt("");
    try {
      if (!current) {
        const created = await client.createRun({
          prompt: text,
          repoUrls: [],
          envId: envId || undefined,
          source,
          model: resolveChatModel(model),
          expertId: expertId || undefined,
          pluginIds: pluginId ? [pluginId] : undefined,
          target: targetKind === "desk" ? firstDeskTarget(desks) : { loop: "cloud", tools: "cloud" },
        });
        setRuns((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        await openRun(created.id);
        return;
      }
      await client.followUp(current.id, { text });
    } catch (error) {
      setPrompt(text);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "setup",
          text: error instanceof Error ? error.message : "发送失败",
          createdAt: new Date().toISOString(),
          kind: "run.error",
          level: "error",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const applyPlus = (action: BuddyPlusAction) => {
    setPlusOpen(false);
    if (action === "expert") {
      go("/experts");
      return;
    }
    if (action === "skill") {
      go("/skills");
      return;
    }
    if (action === "repo" || action === "image" || action === "file" || action === "camera") {
      go("/settings");
      return;
    }
    if (action === "new") {
      resetHome();
      return;
    }
    if (action === "pr" && current) {
      void client.openPullRequest(current.id, current.prompt || "Agent changes").catch(() => undefined);
    }
  };

  if (!ready) return <div className="auth"><p>正在进入…</p></div>;

  if (!token) {
    return (
      <BuddyLogin
        busy={busy}
        error={authError}
        onSubmit={(nextEmail, nextPassword) => void loginWith(nextEmail, nextPassword)}
      />
    );
  }

  if (route.screen === "settings") {
    return (
      <div className="app">
        <header className="topbar">
          <button className="ghost" type="button" onClick={() => go("/")}>返回</button>
          <h1>设置</h1>
        </header>
        <div className="auth-card settings-card">
          <label>
            控制面地址
            <input
              value={apiUrl}
              onChange={(event) => setApiUrl(event.target.value)}
              onBlur={() => void store.setApiUrl(apiUrl)}
            />
          </label>
          <p className="hint">推送在原生 App 登记设备后，走同一套 idle / error / PR 通知。</p>
          <button
            className="primary"
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
    );
  }

  if (route.screen === "experts") {
    return (
      <CatalogList
        title="专家"
        empty="还没有专家。"
        items={experts.map((item) => ({ id: item.id, label: item.name, hint: item.title ?? item.description }))}
        onBack={() => go("/")}
        onPick={(id) => {
          setExpertId(id);
          go("/");
        }}
      />
    );
  }

  if (route.screen === "skills") {
    return (
      <CatalogList
        title="技能"
        empty="还没有技能。"
        items={plugins.map((item) => ({ id: item.id, label: pluginPickerLabel(item), hint: item.description }))}
        onBack={() => go("/")}
        onPick={(id) => {
          setPluginId(id);
          const plugin = plugins.find((item) => item.id === id);
          if (plugin?.interface?.defaultPrompt?.[0]) setPrompt(plugin.interface.defaultPrompt[0]);
          go("/");
        }}
      />
    );
  }

  if (route.screen === "projects") {
    return (
      <CatalogList
        title="项目"
        empty="还没有项目。"
        items={projects.map((item) => ({ id: item.id, label: item.name, hint: item.instruction }))}
        onBack={() => go("/")}
        onPick={() => go("/")}
      />
    );
  }

  const archived = isComposerClosed(current?.status);
  const hostLock = remoteControlSendLock(current, desks);
  const locked = Boolean(current) && (archived || hostLock.locked);
  const running = current?.status === "RUNNING";
  const composer = (
    <>
      <BuddyComposer
        prompt={prompt}
        followUp={Boolean(current)}
        locked={locked}
        placeholder={archived ? "对话已归档。" : hostLock.locked ? hostLock.hint : "说说你要做什么"}
        sending={sending}
        canStop={Boolean(current) && running}
        model={model}
        onModel={setModel}
        onPrompt={setPrompt}
        onSend={() => void send()}
        onStop={current ? () => void client.abort(current.id) : undefined}
        onOpenSettings={() => go("/settings")}
        onOpenPlus={() => setPlusOpen(true)}
      />
      <p className="buddy-footer">内容由 AI 生成 · DeepSeek</p>
      <BuddyPlusSheet open={plusOpen} canOpenPr={Boolean(current)} onClose={() => setPlusOpen(false)} onAction={applyPlus} />
    </>
  );

  const drawer = (
    <BuddyDrawer
      open={sidebarOpen}
      runs={runs}
      userEmail={email}
      health={`在线 · ${model.includes("pro") ? "Pro" : "Flash"}`}
      target={targetKind}
      deskDisabled={deskDisabled}
      onTarget={setTargetKind}
      onClose={() => setSidebarOpen(false)}
      onNew={resetHome}
      onOpenRun={(id) => void openRun(id)}
      onOpenNav={(id) => {
        setSidebarOpen(false);
        if (id === "automations") go("/settings");
        else go(`/${id}`);
      }}
    />
  );

  if (route.screen === "chat") {
    return (
      <div className="app is-buddy">
        <header className="topbar">
          <button className="icon-btn" type="button" aria-label="打开任务" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <span className={running ? "buddy-status-pill is-busy" : "buddy-status-pill"}>
            {running ? "跑着" : STATUS_LABELS[current?.status ?? ""] ?? current?.status ?? "对话"}
          </span>
        </header>
        <div className="transcript" ref={transcriptRef}>
          {messages.length === 0 ? <p className="empty">还没有消息。</p> : null}
          {messages.map((message) => (
            <article key={message.id} className={`bubble ${message.role}`}>
              {transcriptGroups(message).map((group, index) =>
                group.type === "text" ? (
                  <p key={`${message.id}-t${index}`}>{group.text}</p>
                ) : (
                  <div key={`${message.id}-g${index}`}>
                    {group.tools.map((tool) => (
                      <div key={tool.id ?? tool.name} className={`tool${tool.isError ? " err" : tool.status === "running" ? " run" : ""}`}>
                        <b>
                          {tool.status === "running" ? "…" : tool.isError ? "✗" : "✓"} {toolDisplayName(tool)}
                        </b>
                        {toolArgPreview(tool.args) ? <span className="cmd">{toolArgPreview(tool.args)}</span> : null}
                      </div>
                    ))}
                  </div>
                ),
              )}
            </article>
          ))}
        </div>
        {composer}
        {drawer}
      </div>
    );
  }

  return (
    <div className="app is-buddy">
      <header className="topbar">
        <button className="icon-btn" type="button" aria-label="打开任务" onClick={() => setSidebarOpen(true)}>
          ☰
        </button>
      </header>
      <BuddyHome
        moreOpen={moreOpen}
        target={targetKind}
        deskDisabled={deskDisabled}
        skills={buddySkillsFromRecipes(BUNDLED_RECIPES)}
        onTarget={setTargetKind}
        onShortcut={(id) => {
          if (id === "more") setMoreOpen((value) => !value);
          if (id === "experts") go("/experts");
          if (id === "skills") go("/skills");
          if (id === "projects") go("/projects");
        }}
        onSkill={(id) => {
          const recipe = recipeById(id);
          if (recipe) {
            setPrompt(recipe.prompt);
            if (recipe.expertId) setExpertId(recipe.expertId);
            if (recipe.pluginIds?.[0]) setPluginId(recipe.pluginIds[0]);
            setMoreOpen(false);
          }
        }}
      />
      {composer}
      {drawer}
    </div>
  );
}

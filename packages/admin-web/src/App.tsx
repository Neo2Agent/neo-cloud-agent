import { Tooltip } from "@neo-cloud-agent/ui";
import { useCallback, useEffect, useState } from "react";
import { api, readJson, readToken, writeToken } from "./api";
import { Sidebar } from "./components/Sidebar";
import { IconExperts, IconLogout, IconMenu, IconOverview, IconRefresh, IconRuns, IconSidebarClose, IconSystem, IconUsers } from "./icons";
import { PAGE_META, pageHref, readPage } from "./nav";
import { ExpertsScreen } from "./screens/ExpertsScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { OverviewScreen } from "./screens/OverviewScreen";
import { RunsScreen } from "./screens/RunsScreen";
import { SystemScreen } from "./screens/SystemScreen";
import { UsersScreen } from "./screens/UsersScreen";
import type { AdminExpertsCatalog, AdminOverview, AdminPage, AdminRun, AdminUser, RateLimitSnapshot } from "./types";

const NAV: Array<{ id: AdminPage; icon: typeof IconOverview }> = [
  { id: "overview", icon: IconOverview },
  { id: "users", icon: IconUsers },
  { id: "runs", icon: IconRuns },
  { id: "experts", icon: IconExperts },
  { id: "system", icon: IconSystem },
];

function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export function App() {
  const [token, setToken] = useState(readToken);
  const [page, setPage] = useState<AdminPage>(readPage);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [runs, setRuns] = useState<AdminRun[]>([]);
  const [limits, setLimits] = useState<RateLimitSnapshot | null>(null);
  const [experts, setExperts] = useState<AdminExpertsCatalog | null>(null);
  const [error, setError] = useState("");
  const [approvingId, setApprovingId] = useState("");
  const narrow = useNarrow();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    if (window.matchMedia("(max-width: 860px)").matches) return false;
    return window.localStorage.getItem("neo.admin.sidebar") !== "0";
  });

  const persist = (next: string) => {
    writeToken(next);
    setToken(next);
  };

  const toggleSidebar = () => {
    setSidebarOpen((value) => {
      const next = !value;
      window.localStorage.setItem("neo.admin.sidebar", next ? "1" : "0");
      return next;
    });
  };

  const refresh = useCallback(async (session: string) => {
    const [overviewRes, usersRes, runsRes, limitsRes, meRes, expertsRes] = await Promise.all([
      api(session, "/v1/admin/overview"),
      api(session, "/v1/admin/users"),
      api(session, "/v1/admin/runs?limit=50"),
      api(session, "/v1/rate-limits"),
      api(session, "/v1/me"),
      api(session, "/v1/admin/experts"),
    ]);
    if (meRes.status === 401 || overviewRes.status === 401) {
      persist("");
      throw new Error("请重新登录");
    }
    if (overviewRes.status === 403) {
      persist("");
      throw new Error("需要平台管理员");
    }
    if (!overviewRes.ok) throw new Error("读取总览失败");
    const me = await readJson<{ user?: { email?: string } }>(meRes);
    setUserEmail(me.user?.email ?? "服务令牌");
    setOverview(await readJson<AdminOverview>(overviewRes));
    setUsers((await readJson<{ users?: AdminUser[] }>(usersRes)).users ?? []);
    setRuns((await readJson<{ runs?: AdminRun[] }>(runsRes)).runs ?? []);
    if (limitsRes.ok) setLimits(await readJson<RateLimitSnapshot>(limitsRes));
    if (expertsRes.ok) setExperts(await readJson<AdminExpertsCatalog>(expertsRes));
    setError("");
  }, []);

  useEffect(() => {
    const onHash = () => setPage(readPage());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!token) return;
    setRefreshing(true);
    void refresh(token)
      .catch((err) => {
        const message = err instanceof Error ? err.message : "读取失败";
        if (message === "请重新登录" || message === "需要平台管理员") {
          setAuthError(message);
          persist("");
          return;
        }
        setError(message);
      })
      .finally(() => setRefreshing(false));
  }, [refresh, token]);

  if (!token) {
    return (
      <LoginScreen
        email={email}
        password={password}
        busy={busy}
        error={authError}
        onEmail={setEmail}
        onPassword={setPassword}
        onSubmit={() => {
          if (busy || !email.trim() || !password) return;
          setBusy(true);
          setAuthError("");
          void (async () => {
            const response = await api("", "/v1/auth/login", {
              method: "POST",
              body: JSON.stringify({ email: email.trim(), password }),
            });
            const body = await readJson<{ token?: string; error?: string; user?: { email?: string } }>(response);
            if (!response.ok) throw new Error(body.error === "admin_required" ? "需要平台管理员" : body.error || "登录失败");
            persist(body.token ?? "");
            setUserEmail(body.user?.email ?? "");
            setPassword("");
          })()
            .catch((err) => setAuthError(err instanceof Error ? err.message : "登录失败"))
            .finally(() => setBusy(false));
        }}
      />
    );
  }

  const meta = PAGE_META[page];
  const liveRuns = runs
    .filter((item) => item.status === "RUNNING" || item.status === "PROVISIONING" || item.status === "INSTALLING" || item.status === "WAITING_FOR_BACKGROUND_WORK")
    .slice(0, 8);
  const health = overview
    ? `${overview.platform.workerRuntime}${overview.capacity.total ? ` · VM ${overview.capacity.busy}/${overview.capacity.total}` : ""}`
    : "读取中…";

  const logout = () => {
    void api(token, "/v1/auth/logout", { method: "POST" });
    persist("");
    setOverview(null);
    setUsers([]);
    setRuns([]);
    setLimits(null);
    setExperts(null);
    setError("");
  };

  const openPage = (id: AdminPage) => {
    location.hash = pageHref(id);
    if (narrow && sidebarOpen) {
      window.localStorage.setItem("neo.admin.sidebar", "0");
      setSidebarOpen(false);
    }
  };

  return (
    <div className={sidebarOpen ? "app" : "app sidebar-closed"}>
      {sidebarOpen ? <div className="sidebar-backdrop" onClick={toggleSidebar} /> : null}
      <Sidebar
        userEmail={userEmail}
        health={health}
        overview={overview}
        liveRuns={liveRuns}
        onOpenRuns={() => openPage("runs")}
        onClose={narrow ? toggleSidebar : undefined}
      />

      <div className="main">
        <header className="topbar">
          <div className="topbar-lead">
            <Tooltip content={sidebarOpen ? "收起侧栏" : "打开侧栏"} side="bottom">
              <button
                className="icon-btn sidebar-toggle"
                type="button"
                aria-label={sidebarOpen ? "收起侧栏" : "打开侧栏"}
                onClick={toggleSidebar}
              >
                {sidebarOpen ? <IconSidebarClose /> : <IconMenu />}
              </button>
            </Tooltip>
            <nav className="app-tabs" aria-label="管理台导航">
              {NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <Tooltip key={item.id} content={PAGE_META[item.id].label} side="bottom">
                    <a
                      href={pageHref(item.id)}
                      className={page === item.id ? "active" : ""}
                      aria-label={PAGE_META[item.id].label}
                      aria-current={page === item.id ? "page" : undefined}
                      onClick={() => {
                        if (narrow && sidebarOpen) {
                          window.localStorage.setItem("neo.admin.sidebar", "0");
                          setSidebarOpen(false);
                        }
                      }}
                    >
                      <Icon size={16} />
                      <span className="tab-label">{PAGE_META[item.id].label}</span>
                    </a>
                  </Tooltip>
                );
              })}
            </nav>
            <div className="topbar-heading">
              <p className="eyebrow">{meta.label}</p>
              <h1>{meta.title}</h1>
            </div>
          </div>
          <div className="top-actions">
            <Tooltip content="刷新" side="bottom">
              <button
                type="button"
                className="icon-btn"
                aria-label="刷新"
                disabled={refreshing}
                onClick={() => {
                  setRefreshing(true);
                  void refresh(token)
                    .catch((err) => setError(err instanceof Error ? err.message : "刷新失败"))
                    .finally(() => setRefreshing(false));
                }}
              >
                <IconRefresh className={refreshing ? "spin" : undefined} />
              </button>
            </Tooltip>
            <Tooltip content="退出" side="bottom">
              <button type="button" className="icon-btn" aria-label="退出" onClick={logout}>
                <IconLogout />
              </button>
            </Tooltip>
          </div>
        </header>

        {error ? <p className="banner">{error}</p> : null}

        {!overview ? (
          <section className="page catalog-page">
            <div className="skeleton metric-grid">
              <div />
              <div />
              <div />
              <div />
            </div>
            <div className="skeleton panel" />
          </section>
        ) : null}
        {overview && page === "overview" ? <OverviewScreen overview={overview} runs={runs} /> : null}
        {overview && page === "users" ? (
          <UsersScreen
            users={users}
            approvingId={approvingId}
            onApprove={(id) => {
              setApprovingId(id);
              void (async () => {
                const response = await api(token, `/v1/admin/users/${encodeURIComponent(id)}/approve`, { method: "POST" });
                if (!response.ok) {
                  const body = await readJson<{ error?: string }>(response);
                  throw new Error(body.error || "审核失败");
                }
                await refresh(token);
              })()
                .catch((err) => setError(err instanceof Error ? err.message : "审核失败"))
                .finally(() => setApprovingId(""));
            }}
          />
        ) : null}
        {overview && page === "runs" ? <RunsScreen runs={runs} /> : null}
        {overview && page === "experts" ? <ExpertsScreen token={token} catalog={experts} onChanged={() => refresh(token)} /> : null}
        {overview && page === "system" ? <SystemScreen overview={overview} limits={limits} /> : null}
      </div>
    </div>
  );
}

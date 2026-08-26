import { useCallback, useEffect, useState } from "react";
import { api, readJson, readToken, writeToken } from "./api";
import { IconExperts, IconLogout, IconOverview, IconRefresh, IconRuns, IconSystem, IconUsers } from "./icons";
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

  const persist = (next: string) => {
    writeToken(next);
    setToken(next);
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

  return (
    <div className="app">
      <aside className="rail" aria-label="管理台导航">
        <div className="brand">
          <span className="mark">N</span>
          <div>
            <strong>Neo 管理台</strong>
            <span>平台用量</span>
          </div>
        </div>
        <nav className="rail-nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <a key={item.id} href={pageHref(item.id)} className={page === item.id ? "active" : ""} aria-current={page === item.id ? "page" : undefined}>
                <Icon />
                <span>{PAGE_META[item.id].label}</span>
              </a>
            );
          })}
        </nav>
        <a className="chat-link" href="/">
          返回对话页
        </a>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-copy">
            <p className="eyebrow">独立管理台</p>
            <h1>{meta.title}</h1>
            <p className="muted topbar-hint">{meta.hint}</p>
          </div>
          <div className="top-actions">
            <span className="pill" title={userEmail}>
              {userEmail}
            </span>
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
              <IconRefresh />
            </button>
            <button type="button" className="icon-btn" aria-label="退出" onClick={logout}>
              <IconLogout />
            </button>
          </div>
        </header>

        {error ? <p className="banner">{error}</p> : null}

        <main className="main">
          {!overview ? (
            <div className="stack">
              <div className="skeleton metrics">
                <div />
                <div />
                <div />
                <div />
              </div>
              <div className="skeleton panel" />
            </div>
          ) : null}
          {overview && page === "overview" ? <OverviewScreen overview={overview} runs={runs} /> : null}
          {overview && page === "users" ? <UsersScreen users={users} /> : null}
          {overview && page === "runs" ? <RunsScreen runs={runs} /> : null}
          {overview && page === "experts" ? (
            <ExpertsScreen token={token} catalog={experts} onChanged={() => refresh(token)} />
          ) : null}
          {overview && page === "system" ? <SystemScreen overview={overview} limits={limits} /> : null}
        </main>
      </div>

      <nav className="dock" aria-label="管理台分页">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <a key={item.id} href={pageHref(item.id)} className={page === item.id ? "active" : ""} aria-current={page === item.id ? "page" : undefined}>
              <Icon size={20} />
              <span>{PAGE_META[item.id].label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}

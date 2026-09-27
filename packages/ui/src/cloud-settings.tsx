import { useCallback, useEffect, useState } from "react";
import { Select } from "./select";

export type CloudSettingsEnv = { id: string; name?: string };
export type CloudSettingsBuild = { id: string; envId?: string; status: string; draft?: boolean };
export type GithubAccount = {
  connected: boolean;
  login: string | null;
  oauthConfigured: boolean;
};

export type CloudSettingsClient = {
  getJson: <T>(path: string) => Promise<T>;
  sendJson: <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;
};

type NoticeKind = "ok" | "err";

type Props = {
  client: CloudSettingsClient;
  authorizeHref: string;
  repo?: string;
  envId?: string;
  buildId?: string;
  environments?: CloudSettingsEnv[];
  builds?: CloudSettingsBuild[];
  onRepo?: (value: string) => void;
  onEnv?: (value: string) => void;
  onBuild?: (value: string) => void;
  onWarm?: () => void;
  onNotice?: (message: string, kind?: NoticeKind) => void;
  showWarm?: boolean;
  oauthReturn?: string | null;
  onClearOauthReturn?: () => void;
};

const LOGIN_REQUIRED = "login_required";
const QUOTA_UNLOADED = "配额未加载";
const MCP_DEFAULT_HINT = "HTTP MCP 的 Bearer 只存在控制面。";
const NOTIFY_DEFAULT_HINT = "做完或 PR 开好了会按这里推。";

function asErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function quotaSummary(input: {
  usedTokensMonth?: number;
  maxTokensMonth?: number;
  concurrentRuns?: number;
  maxConcurrentRuns?: number;
}): string {
  return `本月已用 ${input.usedTokensMonth ?? 0}${input.maxTokensMonth ? ` / ${input.maxTokensMonth}` : "（不限）"} tokens，同时 ${input.concurrentRuns ?? 0}${input.maxConcurrentRuns ? ` / ${input.maxConcurrentRuns}` : "（不限）"} 条对话。0 表示不限。`;
}

export function CloudAccountSettings({
  client,
  authorizeHref,
  repo = "",
  envId = "",
  buildId = "",
  environments = [],
  builds = [],
  onRepo,
  onEnv,
  onBuild,
  onWarm,
  onNotice,
  showWarm = true,
  oauthReturn,
  onClearOauthReturn,
}: Props) {
  const envBuilds = builds.filter((item) => item.status === "SUCCEEDED" && (!envId || item.envId === envId));
  const [quotaHint, setQuotaHint] = useState(QUOTA_UNLOADED);
  const [quotaTokens, setQuotaTokens] = useState("");
  const [quotaConcurrent, setQuotaConcurrent] = useState("");
  const [mcpName, setMcpName] = useState("");
  const [mcpBearer, setMcpBearer] = useState("");
  const [mcpHint, setMcpHint] = useState(MCP_DEFAULT_HINT);
  const [github, setGithub] = useState<GithubAccount>({ connected: false, login: null, oauthConfigured: false });
  const [githubBusy, setGithubBusy] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [notifyHint, setNotifyHint] = useState(NOTIFY_DEFAULT_HINT);

  const refreshGithub = useCallback(async () => {
    const account = await client.getJson<GithubAccount & { error?: string }>("/v1/integrations/github");
    if (account.error) {
      throw new Error(account.error);
    }
    setGithub({
      connected: Boolean(account.connected),
      login: account.login ?? null,
      oauthConfigured: Boolean(account.oauthConfigured),
    });
  }, [client]);

  useEffect(() => {
    if (!oauthReturn) return;
    if (oauthReturn === "ok") {
      onNotice?.("已绑定 GitHub");
    } else {
      onNotice?.(oauthReturn === "login_required" ? "请先登录再绑定 GitHub" : `GitHub 绑定失败：${oauthReturn}`, "err");
    }
    onClearOauthReturn?.();
    void refreshGithub().catch((error) => {
      onNotice?.(asErrorMessage(error, "刷新 GitHub 绑定失败"), "err");
    });
  }, [oauthReturn, onClearOauthReturn, onNotice, refreshGithub]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const quota = await client.getJson<{
          usedTokensMonth?: number;
          maxTokensMonth?: number;
          concurrentRuns?: number;
          maxConcurrentRuns?: number;
          error?: string;
        }>("/v1/quota");
        if (cancelled) return;
        if (quota.error) throw new Error(quota.error);
        setQuotaTokens(quota.maxTokensMonth ? String(quota.maxTokensMonth) : "");
        setQuotaConcurrent(quota.maxConcurrentRuns ? String(quota.maxConcurrentRuns) : "");
        setQuotaHint(quotaSummary(quota));
      } catch (error) {
        if (!cancelled) setQuotaHint(asErrorMessage(error, QUOTA_UNLOADED));
      }
      try {
        const mcp = await client.getJson<{ servers?: Array<{ name: string; connected?: boolean }>; error?: string }>(
          "/v1/settings/mcp",
        );
        if (cancelled) return;
        if (mcp.error) throw new Error(mcp.error);
        if (mcp.servers?.length) {
          setMcpHint(`已保存 ${mcp.servers.map((item) => item.name).join("、")}。`);
        }
      } catch (error) {
        if (!cancelled) setMcpHint(asErrorMessage(error, MCP_DEFAULT_HINT));
      }
      try {
        const notify = await client.getJson<{ email?: { configured?: boolean }; error?: string }>("/v1/settings/notify");
        if (cancelled) return;
        if (notify.error) throw new Error(notify.error);
        setNotifyHint(notify.email?.configured ? "已配置完成邮件通知。" : NOTIFY_DEFAULT_HINT);
      } catch (error) {
        if (!cancelled) setNotifyHint(asErrorMessage(error, NOTIFY_DEFAULT_HINT));
      }
      try {
        await refreshGithub();
      } catch (error) {
        if (!cancelled) onNotice?.(asErrorMessage(error, "读取 GitHub 绑定失败"), "err");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, onNotice, refreshGithub]);

  return (
    <div className="cloud-settings" id="cloud-settings">
      {showWarm ? (
        <section className="settings-group">
          <header>
            <h3>仓库与环境</h3>
            <p className="hint">预热环境和快照用。新对话在输入框选仓库，不读这里。</p>
          </header>
          <label className="repo-row">
            <span>预热仓库</span>
            <input
              id="repo"
              name="repo"
              type="text"
              placeholder="fixtures/toy-repo 或 github.com/org/repo"
              autoComplete="off"
              value={repo}
              onChange={(event) => onRepo?.(event.target.value)}
            />
          </label>
          <div className="env-row">
            <label>
              <span>环境</span>
              <Select
                id="environment"
                name="environment"
                value={envId}
                onValueChange={(value) => onEnv?.(value)}
                placeholder="仓库默认"
                options={[
                  { value: "", label: "仓库默认" },
                  ...environments.map((item) => ({ value: item.id, label: item.name || item.id.slice(0, 8) })),
                ]}
              />
            </label>
            <label>
              <span>快照</span>
              <Select
                id="build"
                name="build"
                value={buildId}
                onValueChange={(value) => onBuild?.(value)}
                placeholder="自动（复用 active）"
                options={[
                  { value: "", label: "自动（复用 active）" },
                  { value: "cold", label: "冷装" },
                  ...envBuilds.map((item) => ({
                    value: item.id,
                    label: `${item.id.slice(0, 8)}${item.draft ? " · draft" : ""}`,
                  })),
                ]}
              />
            </label>
          </div>
          {onWarm ? (
            <div className="settings-actions">
              <button className="quiet-btn" id="warm-build" type="button" onClick={onWarm}>
                预热
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="settings-group">
        <header>
          <h3>GitHub 账号</h3>
          <p className="hint" id="github-account-status">
            {github.connected
              ? `已绑定 @${github.login}。选仓和 push 用这个账号。`
              : github.oauthConfigured
                ? "绑定后，新对话可以从你的仓库里搜索选择。"
                : "管理员还没配置 GitHub OAuth（GITHUB_OAUTH_CLIENT_ID）。"}
          </p>
        </header>
        <div className="settings-actions">
          {github.connected ? (
            <button
              className="ghost"
              id="github-disconnect"
              type="button"
              disabled={githubBusy}
              onClick={() => {
                void (async () => {
                  setGithubBusy(true);
                  try {
                    const saved = await client.sendJson<GithubAccount & { error?: string }>("/v1/integrations/github", {
                      method: "DELETE",
                    });
                    if (saved.error) throw new Error(saved.error);
                    setGithub({
                      connected: false,
                      login: null,
                      oauthConfigured: saved.oauthConfigured ?? github.oauthConfigured,
                    });
                    onNotice?.("已解除 GitHub 绑定");
                  } catch (error) {
                    onNotice?.(asErrorMessage(error, "解除失败"), "err");
                  } finally {
                    setGithubBusy(false);
                  }
                })();
              }}
            >
              解除绑定
            </button>
          ) : (
            <a
              className="quiet-btn primary"
              id="github-connect"
              href={authorizeHref}
              aria-disabled={!github.oauthConfigured}
              onClick={(event) => {
                if (!github.oauthConfigured) event.preventDefault();
              }}
            >
              绑定 GitHub
            </a>
          )}
        </div>
      </section>

      <section className="settings-group">
        <header>
          <h3>额度</h3>
          <p className="hint" id="quota-status">
            {quotaHint}
          </p>
        </header>
        <div className="env-row">
          <label>
            <span>本月 token 上限</span>
            <input
              id="quota-tokens"
              name="quota-tokens"
              type="number"
              min={0}
              placeholder="0 = 不限"
              value={quotaTokens}
              onChange={(event) => setQuotaTokens(event.target.value)}
            />
          </label>
          <label>
            <span>同时跑的对话</span>
            <input
              id="quota-concurrent"
              name="quota-concurrent"
              type="number"
              min={0}
              placeholder="0 = 不限"
              value={quotaConcurrent}
              onChange={(event) => setQuotaConcurrent(event.target.value)}
            />
          </label>
        </div>
        <div className="settings-actions">
          <button
            className="quiet-btn primary"
            id="save-quota"
            type="button"
            onClick={() => {
              void (async () => {
                const saved = await client.sendJson<{
                  usedTokensMonth?: number;
                  maxTokensMonth?: number;
                  concurrentRuns?: number;
                  maxConcurrentRuns?: number;
                  error?: string;
                }>("/v1/settings/quota", {
                  method: "POST",
                  body: {
                    maxTokensMonth: Number(quotaTokens) || 0,
                    maxConcurrentRuns: Number(quotaConcurrent) || 0,
                  },
                });
                if (saved.error === LOGIN_REQUIRED) throw new Error("请先登录再保存配额");
                if (saved.error) throw new Error(saved.error);
                setQuotaHint(quotaSummary(saved));
                onNotice?.("配额已保存");
              })().catch((error) => {
                const message = asErrorMessage(error, "保存配额失败");
                setQuotaHint(message);
                onNotice?.(message, "err");
              });
            }}
          >
            保存配额
          </button>
        </div>
      </section>

      <section className="settings-group">
        <header>
          <h3>集成</h3>
          <p className="hint" id="mcp-status">
            {mcpHint}
          </p>
        </header>
        <div className="env-row">
          <label>
            <span>MCP 服务器名</span>
            <input
              id="mcp-name"
              name="mcp-name"
              type="text"
              autoComplete="off"
              placeholder="environment.json 里的 name"
              value={mcpName}
              onChange={(event) => setMcpName(event.target.value)}
            />
          </label>
          <label>
            <span>MCP Bearer</span>
            <input
              id="mcp-bearer"
              name="mcp-bearer"
              type="password"
              autoComplete="new-password"
              placeholder="只存在控制面"
              value={mcpBearer}
              onChange={(event) => setMcpBearer(event.target.value)}
            />
          </label>
        </div>
        <div className="settings-actions">
          <button
            className="quiet-btn primary"
            id="save-mcp"
            type="button"
            onClick={() => {
              void (async () => {
                if (!mcpName.trim() || !mcpBearer.trim()) return;
                const saved = await client.sendJson<{ servers?: Array<{ name: string }>; error?: string }>(
                  "/v1/settings/mcp",
                  {
                    method: "POST",
                    body: { name: mcpName.trim(), bearer: mcpBearer.trim() },
                  },
                );
                if (saved.error === LOGIN_REQUIRED) throw new Error("请先登录再保存 MCP");
                if (saved.error) throw new Error(saved.error);
                setMcpBearer("");
                setMcpHint(`已保存 ${(saved.servers ?? []).map((item) => item.name).join("、") || mcpName}。`);
                onNotice?.("MCP 已保存");
              })().catch((error) => {
                const message = asErrorMessage(error, "保存 MCP 失败");
                setMcpHint(message);
                onNotice?.(message, "err");
              });
            }}
          >
            保存 MCP
          </button>
        </div>
        <div className="env-row">
          <label>
            <span>完成通知邮箱</span>
            <input
              id="notify-email"
              name="notify-email"
              type="email"
              autoComplete="off"
              placeholder="you@example.com"
              value={emailTo}
              onChange={(event) => setEmailTo(event.target.value)}
            />
          </label>
          <label>
            <span>SMTP 主机</span>
            <input
              id="smtp-host"
              name="smtp-host"
              type="text"
              autoComplete="off"
              placeholder="smtp.example.com"
              value={smtpHost}
              onChange={(event) => setSmtpHost(event.target.value)}
            />
          </label>
        </div>
        <div className="env-row">
          <label>
            <span>SMTP 用户</span>
            <input
              id="smtp-user"
              name="smtp-user"
              type="text"
              autoComplete="off"
              value={smtpUser}
              onChange={(event) => setSmtpUser(event.target.value)}
            />
          </label>
          <label>
            <span>SMTP 密码</span>
            <input
              id="smtp-pass"
              name="smtp-pass"
              type="password"
              autoComplete="new-password"
              value={smtpPass}
              onChange={(event) => setSmtpPass(event.target.value)}
            />
          </label>
          <label>
            <span>发件人</span>
            <input
              id="smtp-from"
              name="smtp-from"
              type="text"
              autoComplete="off"
              placeholder="neo@example.com"
              value={smtpFrom}
              onChange={(event) => setSmtpFrom(event.target.value)}
            />
          </label>
        </div>
        <p className="hint" id="notify-status">
          {notifyHint}
        </p>
        <div className="settings-actions">
          <button
            className="quiet-btn primary"
            id="save-notify"
            type="button"
            onClick={() => {
              void (async () => {
                const saved = await client.sendJson<{ email?: { configured?: boolean }; error?: string }>(
                  "/v1/settings/notify",
                  {
                    method: "POST",
                    body: {
                      emailTo: emailTo.trim(),
                      smtpHost: smtpHost.trim(),
                      smtpUser: smtpUser.trim(),
                      smtpPass,
                      smtpFrom: smtpFrom.trim(),
                    },
                  },
                );
                if (saved.error === LOGIN_REQUIRED) throw new Error("请先登录再保存通知");
                if (saved.error) throw new Error(saved.error);
                setSmtpPass("");
                setNotifyHint(saved.email?.configured ? "已配置完成邮件通知。" : "还缺 SMTP 主机或收件人。");
                onNotice?.(saved.email?.configured ? "邮件通知已保存" : "通知已保存，还缺 SMTP 或收件人");
              })().catch((error) => {
                const message = asErrorMessage(error, "保存通知失败");
                setNotifyHint(message);
                onNotice?.(message, "err");
              });
            }}
          >
            保存邮件
          </button>
        </div>
      </section>
    </div>
  );
}

export function cloudSettingsFromFetch(
  request: (path: string, init?: RequestInit) => Promise<Response>,
): CloudSettingsClient {
  return {
    async getJson<T>(path: string): Promise<T> {
      const response = await request(path);
      const body = (await response.json()) as T & { error?: string };
      if (!response.ok) {
        throw new Error(body.error || `GET ${path} ${response.status}`);
      }
      return body;
    },
    async sendJson<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
      const response = await request(path, {
        method: init?.method ?? "POST",
        headers: { "content-type": "application/json" },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const body = (await response.json()) as T & { error?: string };
      if (!response.ok) {
        throw new Error(body.error || `${init?.method ?? "POST"} ${path} ${response.status}`);
      }
      return body;
    },
  };
}

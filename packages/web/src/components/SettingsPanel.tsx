import { Select } from "@neo-cloud-agent/ui";
import { chatModelLabel } from "@neo-cloud-agent/contracts/llm-ids";
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { api, readJson } from "../api";
import { toast } from "../feedback";

export type LlmSettings = {
  configured: boolean;
  upstream: string;
  model: string | null;
  newApi?: { url: string | null; consoleUrl: string | null };
  models?: Array<{ id: string; label: string }>;
  modelsSource?: "newapi" | "static";
};

export type ScmSettings = {
  configured: boolean;
  method: "github-app" | "pat" | "none";
};

export type EnvOption = { id: string; name?: string };
export type BuildOption = { id: string; envId?: string; status: string; draft?: boolean };

export type GithubAccount = {
  connected: boolean;
  login: string | null;
  oauthConfigured: boolean;
};

type Props = {
  repo: string;
  envId: string;
  buildId: string;
  environments: EnvOption[];
  builds: BuildOption[];
  llm: LlmSettings;
  llmKey: string;
  onRepo: (value: string) => void;
  onEnv: (value: string) => void;
  onBuild: (value: string) => void;
  onLlmUpstream: (value: string) => void;
  onLlmModel: (value: string) => void;
  onLlmKey: (value: string) => void;
  onSaveLlm: () => void;
  onWarm: () => void;
  token?: string;
};

export function SettingsPanel({
  repo,
  envId,
  buildId,
  environments,
  builds,
  llm,
  llmKey,
  onRepo,
  onEnv,
  onBuild,
  onLlmUpstream,
  onLlmModel: _onLlmModel,
  onLlmKey,
  onSaveLlm,
  onWarm,
  token = "",
}: Props) {
  const envBuilds = builds.filter((item) => item.status === "SUCCEEDED" && (!envId || item.envId === envId));
  const deepseek = llm.upstream !== "openai";
  const newApiConsole = llm.newApi?.consoleUrl || llm.newApi?.url || "";
  const newApiManaged = Boolean(newApiConsole);
  const [quotaHint, setQuotaHint] = useState("配额未加载");
  const [quotaTokens, setQuotaTokens] = useState("");
  const [quotaConcurrent, setQuotaConcurrent] = useState("");
  const [mcpName, setMcpName] = useState("");
  const [mcpBearer, setMcpBearer] = useState("");
  const [mcpHint, setMcpHint] = useState("HTTP MCP 的 Bearer 只存在控制面。");
  const [github, setGithub] = useState<GithubAccount>({ connected: false, login: null, oauthConfigured: false });
  const [githubBusy, setGithubBusy] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [notifyHint, setNotifyHint] = useState("做完或 PR 开好了会按这里推。");

  const refreshGithub = useCallback(async () => {
    if (!token) return;
    try {
      const account = await readJson<GithubAccount & { error?: string }>(await api(token, "/v1/integrations/github"));
      if (!account.error) {
        setGithub({
          connected: Boolean(account.connected),
          login: account.login ?? null,
          oauthConfigured: Boolean(account.oauthConfigured),
        });
      }
    } catch {
      // optional
    }
  }, [token]);

  useEffect(() => {
    const match = /[?&]github=([^&]+)/.exec(location.hash);
    if (match?.[1]) {
      const reason = decodeURIComponent(match[1]);
      if (reason === "ok") {
        toast("已绑定 GitHub");
      } else if (reason) {
        toast(reason === "login_required" ? "请先登录再绑定 GitHub" : `GitHub 绑定失败：${reason}`, "err");
      }
      history.replaceState(null, "", "/#/settings");
      void refreshGithub();
    }
  }, [refreshGithub]);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const quota = await readJson<{
          usedTokensMonth?: number;
          maxTokensMonth?: number;
          concurrentRuns?: number;
          maxConcurrentRuns?: number;
          error?: string;
        }>(await api(token, "/v1/quota"));
        if (!quota.error) {
          setQuotaTokens(quota.maxTokensMonth ? String(quota.maxTokensMonth) : "");
          setQuotaConcurrent(quota.maxConcurrentRuns ? String(quota.maxConcurrentRuns) : "");
          setQuotaHint(
            `本月已用 ${quota.usedTokensMonth ?? 0}${quota.maxTokensMonth ? ` / ${quota.maxTokensMonth}` : "（不限）"} tokens，同时 ${quota.concurrentRuns ?? 0}${quota.maxConcurrentRuns ? ` / ${quota.maxConcurrentRuns}` : "（不限）"} 条对话。0 表示不限。`,
          );
        }
      } catch {
        // optional
      }
      try {
        const mcp = await readJson<{ servers?: Array<{ name: string; connected?: boolean }>; error?: string }>(
          await api(token, "/v1/settings/mcp"),
        );
        if (!mcp.error && mcp.servers?.length) {
          setMcpHint(`已保存 ${mcp.servers.map((item) => item.name).join("、")}。`);
        }
      } catch {
        // optional
      }
      try {
        const notify = await readJson<{ email?: { configured?: boolean }; error?: string }>(
          await api(token, "/v1/settings/notify"),
        );
        if (!notify.error) {
          setNotifyHint(notify.email?.configured ? "已配置完成邮件通知。" : "做完或 PR 开好了会按这里推。");
        }
      } catch {
        // optional
      }
      await refreshGithub();
    })();
  }, [token, refreshGithub]);

  return (
    <div className="settings-panel" id="settings-panel">
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
            onChange={(event) => onRepo(event.target.value)}
          />
        </label>
        <div className="env-row">
          <label>
            <span>环境</span>
            <Select
              id="environment"
              name="environment"
              value={envId}
              onValueChange={onEnv}
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
              onValueChange={onBuild}
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
        <div className="settings-actions">
          <button className="quiet-btn" id="warm-build" type="button" onClick={onWarm}>
            预热
          </button>
        </div>
      </section>

      <section className="settings-group">
        <header>
          <h3>模型</h3>
          <p className="hint" id="llm-status">
            {newApiManaged
              ? "渠道在 New API。对话里选模型；DeepSeek 别名仍收成 Flash 4.1。"
              : llm.configured
                ? `已配置 ${chatModelLabel(llm.model)}，对话走真实模型。`
                : "未配置 API Key，当前是 mock 回复。"}
          </p>
        </header>
        <div className="env-row llm-row">
          <label>
            <span>模型上游</span>
            <Select
              id="llm-upstream"
              name="llm-upstream"
              value={llm.upstream === "openai" ? "openai" : "deepseek"}
              onValueChange={onLlmUpstream}
              options={[
                { value: "deepseek", label: "DeepSeek" },
                { value: "openai", label: "OpenAI" },
              ]}
            />
          </label>
          <label hidden={!deepseek}>
            <span>可选模型</span>
            <p className="hint" id="llm-model">
              {llm.models?.length
                ? llm.models.map((item) => item.label).join("、")
                : "Flash 4.1 与 Step 5 Preview。对话里切换。"}
            </p>
          </label>
          {newApiManaged ? (
            <a className="ghost llm-console-link" href={newApiConsole} target="_blank" rel="noreferrer">
              New API
            </a>
          ) : (
            <label>
              <span>API Key</span>
              <input
                id="llm-key"
                name="llm-key"
                type="password"
                autoComplete="new-password"
                placeholder={llm.configured ? "已保存，留空则保持" : "sk-…"}
                value={llmKey}
                onChange={(event) => onLlmKey(event.target.value)}
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSaveLlm();
                  }
                }}
              />
            </label>
          )}
        </div>
        <div className="settings-actions">
          <button className="quiet-btn primary" id="save-llm" type="button" onClick={onSaveLlm}>
            保存模型
          </button>
        </div>
      </section>

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
                    const saved = await readJson<GithubAccount & { error?: string }>(
                      await api(token, "/v1/integrations/github", { method: "DELETE" }),
                    );
                    if (saved.error) throw new Error(saved.error);
                    setGithub({
                      connected: false,
                      login: null,
                      oauthConfigured: saved.oauthConfigured ?? github.oauthConfigured,
                    });
                    toast("已解除 GitHub 绑定");
                  } catch (error) {
                    toast(error instanceof Error ? error.message : "解除失败", "err");
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
              href="/v1/integrations/github/authorize"
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
                const saved = await readJson<{
                  usedTokensMonth?: number;
                  maxTokensMonth?: number;
                  concurrentRuns?: number;
                  maxConcurrentRuns?: number;
                  error?: string;
                }>(
                  await api(token, "/v1/settings/quota", {
                    method: "POST",
                    body: JSON.stringify({
                      maxTokensMonth: Number(quotaTokens) || 0,
                      maxConcurrentRuns: Number(quotaConcurrent) || 0,
                    }),
                  }),
                );
                if (saved.error === "login_required") throw new Error("请先登录再保存配额");
                if (saved.error) throw new Error(saved.error);
                setQuotaHint(
                  `本月已用 ${saved.usedTokensMonth ?? 0}${saved.maxTokensMonth ? ` / ${saved.maxTokensMonth}` : "（不限）"} tokens，同时 ${saved.concurrentRuns ?? 0}${saved.maxConcurrentRuns ? ` / ${saved.maxConcurrentRuns}` : "（不限）"} 条对话。0 表示不限。`,
                );
                toast("配额已保存");
              })().catch((error) => {
                const message = error instanceof Error ? error.message : "保存配额失败";
                setQuotaHint(message);
                toast(message, "err");
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
                const saved = await readJson<{ servers?: Array<{ name: string }>; error?: string }>(
                  await api(token, "/v1/settings/mcp", {
                    method: "POST",
                    body: JSON.stringify({ name: mcpName.trim(), bearer: mcpBearer.trim() }),
                  }),
                );
                if (saved.error === "login_required") throw new Error("请先登录再保存 MCP");
                if (saved.error) throw new Error(saved.error);
                setMcpBearer("");
                setMcpHint(`已保存 ${(saved.servers ?? []).map((item) => item.name).join("、") || mcpName}。`);
                toast("MCP 已保存");
              })().catch((error) => {
                const message = error instanceof Error ? error.message : "保存 MCP 失败";
                setMcpHint(message);
                toast(message, "err");
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
                const saved = await readJson<{ email?: { configured?: boolean }; error?: string }>(
                  await api(token, "/v1/settings/notify", {
                    method: "POST",
                    body: JSON.stringify({
                      emailTo: emailTo.trim(),
                      smtpHost: smtpHost.trim(),
                      smtpUser: smtpUser.trim(),
                      smtpPass: smtpPass,
                      smtpFrom: smtpFrom.trim(),
                    }),
                  }),
                );
                if (saved.error === "login_required") throw new Error("请先登录再保存通知");
                if (saved.error) throw new Error(saved.error);
                setSmtpPass("");
                setNotifyHint(saved.email?.configured ? "已配置完成邮件通知。" : "还缺 SMTP 主机或收件人。");
                toast(saved.email?.configured ? "邮件通知已保存" : "通知已保存，还缺 SMTP 或收件人");
              })().catch((error) => {
                const message = error instanceof Error ? error.message : "保存通知失败";
                setNotifyHint(message);
                toast(message, "err");
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

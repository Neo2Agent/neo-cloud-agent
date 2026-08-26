import { Select } from "@neo-cloud-agent/ui";
import { useEffect, useState, type KeyboardEvent } from "react";
import { api, readJson } from "../api";

export type LlmSettings = {
  configured: boolean;
  upstream: string;
  model: string | null;
};

export type ScmSettings = {
  configured: boolean;
  method: "github-app" | "pat" | "none";
};

export type EnvOption = { id: string; name?: string };
export type BuildOption = { id: string; envId?: string; status: string; draft?: boolean };

type Props = {
  repo: string;
  envId: string;
  buildId: string;
  environments: EnvOption[];
  builds: BuildOption[];
  llm: LlmSettings;
  llmKey: string;
  scm: ScmSettings;
  scmToken: string;
  onRepo: (value: string) => void;
  onEnv: (value: string) => void;
  onBuild: (value: string) => void;
  onLlmUpstream: (value: string) => void;
  onLlmModel: (value: string) => void;
  onLlmKey: (value: string) => void;
  onSaveLlm: () => void;
  onScmToken: (value: string) => void;
  onSaveScm: () => void;
  onClearScm: () => void;
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
  scm,
  scmToken,
  onRepo,
  onEnv,
  onBuild,
  onLlmUpstream,
  onLlmModel,
  onLlmKey,
  onSaveLlm,
  onScmToken,
  onSaveScm,
  onClearScm,
  onWarm,
  token = "",
}: Props) {
  const envBuilds = builds.filter((item) => item.status === "SUCCEEDED" && (!envId || item.envId === envId));
  const deepseek = llm.upstream !== "openai";
  const [quotaHint, setQuotaHint] = useState("配额未加载");
  const [quotaTokens, setQuotaTokens] = useState("");
  const [quotaConcurrent, setQuotaConcurrent] = useState("");
  const [mcpName, setMcpName] = useState("");
  const [mcpBearer, setMcpBearer] = useState("");
  const [mcpHint, setMcpHint] = useState("HTTP MCP 的 Bearer 只存在控制面。");
  const [emailTo, setEmailTo] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [notifyHint, setNotifyHint] = useState("做完或 PR 开好了会按这里推。");

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
    })();
  }, [token]);

  return (
    <div className="settings-panel" id="settings-panel">
      <label className="repo-row">
        <span>仓库</span>
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
        <button className="ghost" id="warm-build" type="button" onClick={onWarm}>
          预热
        </button>
      </div>
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
          <span>DeepSeek 型号</span>
          <Select
            id="llm-model"
            name="llm-model"
            value={
              /vision/i.test(llm.model ?? "")
                ? "deepseek-v4-flash-vision-exp"
                : /pro/i.test(llm.model ?? "")
                  ? "deepseek-v4-pro"
                  : "deepseek-v4-flash"
            }
            onValueChange={onLlmModel}
            options={[
              { value: "deepseek-v4-flash", label: "Flash（便宜）" },
              { value: "deepseek-v4-flash-vision-exp", label: "Flash Vision（看图）" },
              { value: "deepseek-v4-pro", label: "Pro" },
            ]}
          />
        </label>
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
        <button className="ghost" id="save-llm" type="button" onClick={onSaveLlm}>
          保存
        </button>
      </div>
      <p className="hint" id="llm-status">
        {llm.configured
          ? `已配置 ${deepseek ? (/vision/i.test(llm.model ?? "") ? "DeepSeek Flash Vision" : /pro/i.test(llm.model ?? "") ? "DeepSeek Pro" : "DeepSeek Flash") : "OpenAI"}，对话走真实模型。贴图时会自动走视觉模型。`
          : "未配置 API Key，当前是 mock 回复。"}
      </p>
      <div className="env-row llm-row">
        <label>
          <span>GitHub PAT</span>
          <input
            id="scm-token"
            name="scm-token"
            type="password"
            autoComplete="new-password"
            placeholder={scm.configured ? "已保存，留空则保持" : "ghp_… 或 github_pat_…"}
            value={scmToken}
            onChange={(event) => onScmToken(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSaveScm();
              }
            }}
          />
        </label>
        <button className="ghost" id="save-scm" type="button" onClick={onSaveScm}>
          保存
        </button>
        <button className="ghost" id="clear-scm" type="button" onClick={onClearScm} hidden={!scm.configured || scm.method === "github-app"}>
          清除
        </button>
      </div>
      <p className="hint" id="scm-status">
        {scm.method === "github-app"
          ? "已配置 GitHub App，Agent 可以 push / 开 PR。"
          : scm.configured
            ? "已配置 PAT，Agent 可以 push / 开 PR。"
            : "未配置 GitHub 凭证，push 只会记成本地 local://pr。"}
      </p>
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
        <button
          className="ghost"
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
            })().catch((error) => {
              setQuotaHint(error instanceof Error ? error.message : "保存配额失败");
            });
          }}
        >
          保存配额
        </button>
      </div>
      <p className="hint" id="quota-status">
        {quotaHint}
      </p>
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
        <button
          className="ghost"
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
            })().catch((error) => {
              setMcpHint(error instanceof Error ? error.message : "保存 MCP 失败");
            });
          }}
        >
          保存 MCP
        </button>
      </div>
      <p className="hint" id="mcp-status">
        {mcpHint}
      </p>
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
        <button
          className="ghost"
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
            })().catch((error) => {
              setNotifyHint(error instanceof Error ? error.message : "保存通知失败");
            });
          }}
        >
          保存邮件
        </button>
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
    </div>
  );
}

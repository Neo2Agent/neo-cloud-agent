import type { KeyboardEvent } from "react";
import { AutomationsSettings } from "./AutomationsSettings";

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
  token: string;
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
};

export function SettingsPanel({
  repo,
  envId,
  buildId,
  environments,
  builds,
  token,
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
}: Props) {
  const envBuilds = builds.filter((item) => item.status === "SUCCEEDED" && (!envId || item.envId === envId));
  const deepseek = llm.upstream !== "openai";
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
          <select id="environment" name="environment" value={envId} onChange={(event) => onEnv(event.target.value)}>
            <option value="">仓库默认</option>
            {environments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name || item.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>快照</span>
          <select id="build" name="build" value={buildId} onChange={(event) => onBuild(event.target.value)}>
            <option value="">自动（复用 active）</option>
            <option value="cold">冷装</option>
            {envBuilds.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id.slice(0, 8)}
                {item.draft ? " · draft" : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="ghost" id="warm-build" type="button" onClick={onWarm}>
          预热
        </button>
      </div>
      <div className="env-row llm-row">
        <label>
          <span>模型上游</span>
          <select
            id="llm-upstream"
            name="llm-upstream"
            value={llm.upstream === "openai" ? "openai" : "deepseek"}
            onChange={(event) => onLlmUpstream(event.target.value)}
          >
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label hidden={!deepseek}>
          <span>DeepSeek 型号</span>
          <select
            id="llm-model"
            name="llm-model"
            value={/pro/i.test(llm.model ?? "") ? "deepseek-v4-pro" : "deepseek-v4-flash"}
            onChange={(event) => onLlmModel(event.target.value)}
          >
            <option value="deepseek-v4-flash">Flash（便宜）</option>
            <option value="deepseek-v4-pro">Pro</option>
          </select>
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
          ? `已配置 ${deepseek ? (/pro/i.test(llm.model ?? "") ? "DeepSeek Pro" : "DeepSeek Flash") : "OpenAI"}，对话走真实模型。`
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
      <AutomationsSettings token={token} />
    </div>
  );
}

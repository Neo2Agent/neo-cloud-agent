import { CloudAccountSettings, cloudSettingsFromFetch, Select } from "@neo-cloud-agent/ui";
import { chatModelLabel } from "@neo-cloud-agent/contracts/llm-ids";
import { useMemo, useState, type KeyboardEvent } from "react";
import { api } from "../api";
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

function githubOauthReturn(): string | null {
  const match = /[?&]github=([^&]+)/.exec(location.hash);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

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
  const deepseek = llm.upstream !== "openai";
  const newApiConsole = llm.newApi?.consoleUrl || llm.newApi?.url || "";
  const newApiManaged = Boolean(newApiConsole);
  const [oauthReturn, setOauthReturn] = useState(githubOauthReturn);
  const client = useMemo(
    () => cloudSettingsFromFetch((path, init) => api(token, path, init)),
    [token],
  );

  return (
    <div className="settings-panel" id="settings-panel">
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
      <CloudAccountSettings
        client={client}
        authorizeHref="/v1/integrations/github/authorize"
        repo={repo}
        envId={envId}
        buildId={buildId}
        environments={environments}
        builds={builds}
        onRepo={onRepo}
        onEnv={onEnv}
        onBuild={onBuild}
        onWarm={onWarm}
        onNotice={(message, kind) => toast(message, kind === "err" ? "err" : undefined)}
        oauthReturn={oauthReturn}
        onClearOauthReturn={() => {
          setOauthReturn(null);
          history.replaceState(null, "", "/#/settings");
        }}
      />
    </div>
  );
}

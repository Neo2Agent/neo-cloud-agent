import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import type { ImageRef } from "@neo-cloud-agent/contracts/run";

export type LlmSettings = {
  configured: boolean;
  upstream: string;
  model: string | null;
};

export type EnvOption = { id: string; name?: string };
export type BuildOption = { id: string; envId?: string; status: string; draft?: boolean };

type Props = {
  prompt: string;
  repo: string;
  envId: string;
  buildId: string;
  environments: EnvOption[];
  builds: BuildOption[];
  settingsOpen: boolean;
  llm: LlmSettings;
  llmKey: string;
  images: ImageRef[];
  vmHint: string;
  busy?: boolean;
  stopping?: boolean;
  archived?: boolean;
  canStop?: boolean;
  activity?: string;
  onPrompt: (value: string) => void;
  onRepo: (value: string) => void;
  onEnv: (value: string) => void;
  onBuild: (value: string) => void;
  onLlmUpstream: (value: string) => void;
  onLlmModel: (value: string) => void;
  onLlmKey: (value: string) => void;
  onImages: (images: ImageRef[]) => void;
  onSaveLlm: () => void;
  onWarm: () => void;
  onSend: () => void;
  onStop?: () => void;
};

export function Composer({
  prompt,
  repo,
  envId,
  buildId,
  environments,
  builds,
  settingsOpen,
  llm,
  llmKey,
  images,
  vmHint,
  busy = false,
  stopping = false,
  archived = false,
  canStop = false,
  activity,
  onPrompt,
  onRepo,
  onEnv,
  onBuild,
  onLlmUpstream,
  onLlmModel,
  onLlmKey,
  onImages,
  onSaveLlm,
  onWarm,
  onSend,
  onStop,
}: Props) {
  const envBuilds = builds.filter((item) => item.status === "SUCCEEDED" && (!envId || item.envId === envId));
  const deepseek = llm.upstream !== "openai";
  const empty = !prompt.trim() && images.length === 0;
  const hint = archived ? "对话已归档，无法继续发送。" : busy ? (activity ?? "正在进行…") : vmHint;
  const placeholder = archived
    ? "对话已归档。"
    : busy
      ? "可以先写下一句，等结束后再发送。点停止可中断当前回合。"
      : "描述任务。Enter 发送，Shift+Enter 换行。可直接粘贴图片。";
  return (
    <form
      className={busy ? "composer is-busy" : archived ? "composer is-locked" : "composer"}
      id="composer"
      aria-busy={busy}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!busy && !archived) onSend();
      }}
    >
      <div className="settings-panel" id="settings-panel" hidden={!settingsOpen}>
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
      </div>
      {images.length > 0 ? (
        <div className="image-row" id="image-previews">
          {images.map((image, index) => (
            <button
              key={`${image.mediaType}-${index}`}
              type="button"
              className="image-chip"
              onClick={() => onImages(images.filter((_, item) => item !== index))}
            >
              <img src={`data:${image.mediaType};base64,${image.data}`} alt="" />
              去掉
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        id="prompt"
        name="prompt"
        rows={3}
        placeholder={placeholder}
        required={!busy && !archived && images.length === 0}
        disabled={archived}
        value={prompt}
        onChange={(event) => onPrompt(event.target.value)}
        onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
          const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
          if (files.length === 0) return;
          event.preventDefault();
          void Promise.all(files.slice(0, 4).map(readImageRef)).then((next) => {
            onImages([...images, ...next].slice(0, 4));
          });
        }}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!busy && !archived) {
              (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }
        }}
      />
      <div className="composer-bar">
        <p className="hint" id="vm-status" data-busy={busy ? "true" : "false"}>
          {busy ? <span className="pulse-dot" aria-hidden="true" /> : null}
          {hint}
        </p>
        {busy && canStop ? (
          <button type="button" id="abort" className="stop" aria-label="停止生成" onClick={onStop}>
            <span className="stop-icon" aria-hidden="true" />
            {stopping ? "停止中" : "停止"}
          </button>
        ) : (
          <button type="submit" id="send" disabled={archived || empty || busy}>
            {busy ? "发送中" : "发送"}
          </button>
        )}
      </div>
    </form>
  );
}

function readImageRef(file: File): Promise<ImageRef> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read image failed"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve({
        mediaType: file.type || "image/png",
        data: comma >= 0 ? result.slice(comma + 1) : result,
      });
    };
    reader.readAsDataURL(file);
  });
}

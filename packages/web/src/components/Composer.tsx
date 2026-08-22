import { useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import type { ContextUsageSnapshot } from "@neo-cloud-agent/contracts/context-usage";
import type { ImageRef } from "@neo-cloud-agent/contracts/run";
import { isNarrowViewport, shouldSendOnEnter } from "../viewport";
import { ContextUsageControl } from "./ContextUsage";

export type { BuildOption, EnvOption, LlmSettings, ScmSettings } from "./SettingsPanel";

type Props = {
  prompt: string;
  images: ImageRef[];
  vmHint: string;
  busy?: boolean;
  stopping?: boolean;
  archived?: boolean;
  canStop?: boolean;
  activity?: string;
  contextUsage?: ContextUsageSnapshot;
  onPrompt: (value: string) => void;
  onImages: (images: ImageRef[]) => void;
  onSend: () => void;
  onStop?: () => void;
};

export function Composer({
  prompt,
  images,
  vmHint,
  busy = false,
  stopping = false,
  archived = false,
  canStop = false,
  activity,
  contextUsage,
  onPrompt,
  onImages,
  onSend,
  onStop,
}: Props) {
  const [usageOpen, setUsageOpen] = useState(false);
  const empty = !prompt.trim() && images.length === 0;
  const hint = archived ? "对话已归档，无法继续发送。" : busy ? (activity ?? "正在进行…") : vmHint;
  const placeholder = archived
    ? "对话已归档。"
    : busy
      ? "可以先写下一句，等结束后再发送。点停止可中断当前回合。"
      : isNarrowViewport()
      ? "描述任务，点发送。可粘贴图片。"
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
          if (shouldSendOnEnter(event, { narrow: isNarrowViewport() })) {
            event.preventDefault();
            if (!busy && !archived) {
              (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }
        }}
      />
      <div className="composer-bar">
        {contextUsage ? (
          <ContextUsageControl usage={contextUsage} open={usageOpen} onToggle={() => setUsageOpen((open) => !open)} />
        ) : null}
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
          <button type="submit" id="send" className="send" disabled={archived || empty || busy} aria-label={busy ? "发送中" : "发送"}>
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

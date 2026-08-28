import { useMemo, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import type { ContextUsageSnapshot } from "@neo-cloud-agent/contracts/context-usage";
import { encodeExpertPick, expertPickerLabel, type Expert, type ExpertTeam } from "@neo-cloud-agent/contracts/expert";
import type { IntentCapsule } from "@neo-cloud-agent/contracts/recipe";
import { matchIntentCapsules } from "@neo-cloud-agent/contracts/recipe";
import type { AgentMode, ImageRef } from "@neo-cloud-agent/contracts/run";
import type { Desk } from "@neo-cloud-agent/contracts/desk";
import type { DeskTarget } from "../desk";
import { IconArrowUp, IconStop } from "../icons";
import { applyMention, filterMentions, mentionKindLabel, mentionTrigger, type ComposerMention } from "../mention";
import { isNarrowViewport, shouldQueueOnCtrlEnter, shouldSendOnEnter } from "../viewport";
import { Select } from "@neo-cloud-agent/ui";
import { ContextUsageControl } from "./ContextUsage";
import { TargetPicker } from "./TargetPicker";

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
  target: DeskTarget;
  canRunLocal?: boolean;
  folder?: string;
  desks?: Desk[];
  mode: AgentMode;
  model: string;
  models?: Array<{ id: string; label: string }>;
  experts?: Expert[];
  teams?: ExpertTeam[];
  expertValue?: string;
  expertLocked?: boolean;
  mentions?: ComposerMention[];
  showCapsules?: boolean;
  onMention?: (mention: ComposerMention) => void;
  onCapsule?: (capsule: IntentCapsule) => void;
  onTarget: (target: DeskTarget) => void;
  onPickFolder?: () => void;
  onMode: (mode: AgentMode) => void;
  onModel: (model: string) => void;
  onExpert?: (value: string) => void;
  onPrompt: (value: string) => void;
  onImages: (images: ImageRef[]) => void;
  onSend: () => void;
  onQueue?: () => void;
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
  target,
  canRunLocal = false,
  folder,
  desks,
  mode,
  model,
  models = [
    { id: "deepseek-v4-flash", label: "DeepSeek Flash" },
    { id: "deepseek-v4-pro", label: "DeepSeek Pro" },
  ],
  experts = [],
  teams = [],
  expertValue = "",
  expertLocked = false,
  mentions = [],
  showCapsules = false,
  onMention,
  onCapsule,
  onTarget,
  onPickFolder,
  onMode,
  onModel,
  onExpert,
  onPrompt,
  onImages,
  onSend,
  onQueue,
  onStop,
}: Props) {
  const [usageOpen, setUsageOpen] = useState(false);
  const trigger = mentionTrigger(prompt);
  const mentionHits = useMemo(
    () => (trigger ? filterMentions(mentions, trigger.query) : []),
    [mentions, trigger?.query],
  );
  const capsules = showCapsules ? matchIntentCapsules(prompt) : [];
  const empty = !prompt.trim() && images.length === 0;
  const pickMention = (item: ComposerMention) => {
    onPrompt(applyMention(prompt, item));
    onMention?.(item);
  };
  const hint = archived ? "对话已归档，无法继续发送。" : busy ? (activity ?? "正在进行…") : vmHint;
  const placeholder = archived
    ? "对话已归档。"
    : busy
      ? "可以先写下一句，等结束后再发送。点停止可中断当前回合。"
      : isNarrowViewport()
        ? "描述任务，点发送。可粘贴图片。"
        : "描述任务。Enter 发送，Shift+Enter 换行。输入 @ 可点专家、技能或资产。";
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
        rows={isNarrowViewport() ? 2 : 3}
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
          if (mentionHits[0] && event.key === "Enter" && !event.shiftKey && trigger) {
            event.preventDefault();
            pickMention(mentionHits[0]);
            return;
          }
          if (shouldQueueOnCtrlEnter(event)) {
            event.preventDefault();
            if (!archived && onQueue) onQueue();
            return;
          }
          if (shouldSendOnEnter(event, { narrow: isNarrowViewport() })) {
            event.preventDefault();
            if (!busy && !archived) {
              (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }
        }}
      />
      {trigger ? (
        <ul className="mention-menu" role="listbox">
          {mentionHits.length === 0 ? (
            <li className="hint">没有可引用的专家、技能或资产</li>
          ) : (
            mentionHits.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <button type="button" onClick={() => pickMention(item)}>
                  <small>{mentionKindLabel(item.kind)}</small>
                  <span>{item.label}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {capsules.length > 0 && !trigger ? (
        <div className="intent-capsules">
          {capsules.map((item) => (
            <button key={item.id} type="button" className="intent-capsule" onClick={() => onCapsule?.(item)}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="composer-bar">
        <div className="composer-pickers">
          <TargetPicker
            target={target}
            canRunLocal={canRunLocal}
            folder={folder}
            desks={desks}
            onTarget={onTarget}
            onPickFolder={onPickFolder}
          />
          <Select
            id="agent-mode"
            size="pill"
            aria-label="模式"
            value={mode}
            onValueChange={(value) => onMode(value as AgentMode)}
            options={[
              { value: "agent", label: "Agent" },
              { value: "ask", label: "Ask" },
            ]}
          />
          <Select
            id="agent-model"
            size="pill"
            aria-label="模型"
            value={model}
            onValueChange={onModel}
            options={models.map((item) => ({ value: item.id, label: item.label }))}
          />
          <Select
            id="agent-expert"
            size="pill"
            aria-label="专家"
            value={expertValue}
            disabled={expertLocked || !onExpert}
            onValueChange={(value) => onExpert?.(value)}
            groups={[
              { label: "默认", options: [{ value: "", label: "Neo" }] },
              ...(experts.length > 0
                ? [{ label: "专家", options: experts.map((item) => ({ value: encodeExpertPick({ expertId: item.id }), label: expertPickerLabel(item) })) }]
                : []),
              ...(teams.length > 0
                ? [{ label: "专家团", options: teams.map((item) => ({ value: encodeExpertPick({ expertTeamId: item.id }), label: item.name })) }]
                : []),
            ]}
          />
        </div>
        <div className="composer-send-group">
          {contextUsage ? (
            <ContextUsageControl usage={contextUsage} open={usageOpen} onToggle={() => setUsageOpen((open) => !open)} />
          ) : null}
          <p className="hint" id="vm-status" data-busy={busy ? "true" : "false"}>
            {busy ? <span className="pulse-dot" aria-hidden="true" /> : null}
            {hint}
          </p>
          {busy && canStop ? (
            <button type="button" id="abort" className="stop" aria-label={stopping ? "停止中" : "停止生成"} onClick={onStop}>
              <span className="stop-icon" aria-hidden="true">
                <IconStop size={10} />
              </span>
            </button>
          ) : (
            <button type="submit" id="send" className="send" disabled={archived || empty || busy} aria-label={busy ? "发送中" : "发送"}>
              <IconArrowUp size={16} />
            </button>
          )}
        </div>
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

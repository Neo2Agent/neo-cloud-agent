import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import type { ContextUsageSnapshot } from "@neo-cloud-agent/contracts/context-usage";
import { encodeExpertPick, expertPickerLabel, type Expert, type ExpertTeam } from "@neo-cloud-agent/contracts/expert";
import type { IntentCapsule } from "@neo-cloud-agent/contracts/recipe";
import { matchIntentCapsules } from "@neo-cloud-agent/contracts/recipe";
import type { AgentMode, ImageRef } from "@neo-cloud-agent/contracts/run";
import type { Desk } from "@neo-cloud-agent/contracts/desk";
import { pageAllowsLiveMic, type VoiceSession } from "@neo-cloud-agent/ui/speech";
import { BuddyVoiceFileSheet, Select, holdPadLabel, modelShortLabel } from "@neo-cloud-agent/ui";
import { readToken } from "../api";
import type { DeskTarget } from "../desk";
import { IconArrowUp, IconMic, IconPlus, IconStop } from "../icons";
import { applyMention, filterMentions, mentionKindLabel, mentionTrigger, type ComposerMention } from "../mention";
import { applyClickVoice, startWebVoice } from "../speech";
import { isNarrowViewport, shouldQueueOnCtrlEnter, shouldSendOnEnter } from "../viewport";
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
  targetLocked?: boolean;
  targetLockLabel?: string;
  /** Remote Control host is offline; send is blocked until that Desk's inbox is live. */
  blocked?: boolean;
  blockedHint?: string;
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
  layout?: "default" | "buddy";
  followUp?: boolean;
  onOpenPlus?: () => void;
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
  targetLocked = false,
  targetLockLabel,
  blocked = false,
  blockedHint,
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
  layout = "default",
  followUp = false,
  onOpenPlus,
}: Props) {
  const [usageOpen, setUsageOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voicePickOpen, setVoicePickOpen] = useState(false);
  const voiceRef = useRef<VoiceSession | null>(null);
  const startingRef = useRef(false);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const buddy = layout === "buddy";
  useEffect(() => () => {
    void voiceRef.current?.stop();
  }, []);
  const trigger = mentionTrigger(prompt);
  const mentionHits = useMemo(
    () => (trigger ? filterMentions(mentions, trigger.query) : []),
    [mentions, trigger?.query],
  );
  const capsules = showCapsules ? matchIntentCapsules(prompt) : [];
  const empty = !prompt.trim() && images.length === 0;
  const sendLocked = archived || blocked;
  const pickMention = (item: ComposerMention) => {
    onPrompt(applyMention(prompt, item));
    onMention?.(item);
  };
  const hint = voiceError
    ? voiceError
    : archived
      ? "对话已归档，无法继续发送。"
      : blocked
        ? (blockedHint || "发起这条对话的 Desk 离线。打开 Desk 后才能继续。")
        : busy
          ? (activity ?? "正在进行…")
          : vmHint;
  const placeholder = archived
    ? "对话已归档。"
    : blocked
      ? (blockedHint || "发起这条对话的 Desk 离线。打开 Desk 后才能继续。")
      : busy
        ? buddy
          ? "继续说一句…"
          : "可以先写下一句，等结束后再发送。点停止可中断当前回合。"
        : buddy
          ? followUp
            ? "继续说一句…"
            : "说说你要做什么"
          : isNarrowViewport()
            ? "描述任务，点发送。可粘贴图片。"
            : "描述任务。Enter 发送，Shift+Enter 换行。输入 @ 可点专家、技能或资产。";
  const canStartVoice = !sendLocked && !busy && !finishing;
  const voiceLabel = holdPadLabel({
    supported: true,
    holding: listening,
    finishing,
    followUp,
    fileFallback: !pageAllowsLiveMic(),
  });
  const runVoice = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    const oneShot = !pageAllowsLiveMic();
    setVoiceError("");
    if (oneShot) setFinishing(true);
    try {
      const result = await startWebVoice(readToken(), () => undefined, (message) => setVoiceError(message));
      if (result.kind === "cancelled") return;
      if (result.kind === "error") {
        setVoiceError(result.message);
        return;
      }
      if (result.kind === "transcript") {
        const next = applyClickVoice(promptRef.current, result.text);
        if (next !== promptRef.current) onPrompt(next);
        return;
      }
      voiceRef.current = result.session;
      setListening(true);
    } finally {
      startingRef.current = false;
      if (oneShot) setFinishing(false);
    }
  };
  const toggleVoice = async () => {
    if (sendLocked) return;
    if (voiceRef.current) {
      const session = voiceRef.current;
      voiceRef.current = null;
      setListening(false);
      setFinishing(true);
      try {
        const spoken = await session.stop();
        const next = applyClickVoice(promptRef.current, spoken);
        if (next !== promptRef.current) onPrompt(next);
      } finally {
        setFinishing(false);
      }
      return;
    }
    if (!canStartVoice) return;
    if (!pageAllowsLiveMic()) {
      setVoicePickOpen(true);
      return;
    }
    await runVoice();
  };
  const voiceButton = (className: string) => (
    <button
      type="button"
      className={`${className}${listening || finishing ? " is-listening" : ""}`}
      aria-label={voiceLabel}
      aria-pressed={listening}
      disabled={!canStartVoice && !listening}
      onClick={() => void toggleVoice()}
    >
      <IconMic size={18} />
    </button>
  );
  return (
    <form
      className={`${busy ? "composer is-busy" : sendLocked ? "composer is-locked" : "composer"}${buddy ? " buddy-composer" : ""}`}
      id="composer"
      aria-busy={busy}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!busy && !sendLocked) onSend();
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
      {buddy && (voiceError || listening || finishing) ? (
        <p className={voiceError ? "hint voice-error" : "hint"}>{listening ? "正在听…再点一下完成" : finishing ? "正在转文字…" : voiceError}</p>
      ) : null}
      <BuddyVoiceFileSheet
        open={voicePickOpen}
        onClose={() => setVoicePickOpen(false)}
        onPick={() => {
          setVoicePickOpen(false);
          void runVoice();
        }}
      />
      <textarea
        id="prompt"
        name="prompt"
        rows={buddy ? 2 : isNarrowViewport() ? 2 : 3}
        placeholder={placeholder}
        required={!busy && !sendLocked && images.length === 0}
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
            if (!sendLocked && onQueue) onQueue();
            return;
          }
          if (shouldSendOnEnter(event, { narrow: isNarrowViewport() })) {
            event.preventDefault();
            if (!busy && !sendLocked) {
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
      {buddy ? (
        <div className="buddy-composer-bar">
          <div className="buddy-composer-bar-start">
            <button type="button" className="buddy-plus" aria-label="添加" onClick={onOpenPlus}>
              <IconPlus size={20} />
            </button>
            {!sendLocked ? voiceButton("buddy-icon-btn") : null}
            <div className="buddy-model">
              <Select
                id="agent-model"
                size="pill"
                aria-label="模型"
                value={model}
                onValueChange={onModel}
                options={models.map((item) => ({ value: item.id, label: modelShortLabel(item.id) }))}
              />
            </div>
          </div>
          <div className="buddy-composer-bar-end">
            {busy && canStop ? (
              <button type="button" id="abort" className="stop" aria-label={stopping ? "停止中" : "停止生成"} onClick={onStop}>
                <span className="stop-icon" aria-hidden="true">
                  <IconStop size={10} />
                </span>
              </button>
            ) : (
              <button type="submit" id="send" className="send" disabled={sendLocked || empty || busy} aria-label="发送">
                <IconArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="composer-bar">
          <div className="composer-pickers">
            <TargetPicker
              target={target}
              canRunLocal={canRunLocal}
              folder={folder}
              desks={desks}
              locked={targetLocked}
              lockLabel={targetLockLabel}
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
            <p className="hint" id="vm-status" data-busy={busy || listening || finishing ? "true" : "false"}>
              {busy || listening || finishing ? <span className="pulse-dot" aria-hidden="true" /> : null}
              {listening ? "正在听…再点一下完成" : finishing ? "正在转文字…" : hint}
            </p>
            {!sendLocked ? voiceButton("composer-mic") : null}
            {busy && canStop ? (
              <button type="button" id="abort" className="stop" aria-label={stopping ? "停止中" : "停止生成"} onClick={onStop}>
                <span className="stop-icon" aria-hidden="true" />
                {stopping ? "停止中" : "停止"}
              </button>
            ) : (
              <button type="submit" id="send" className="send" disabled={sendLocked || empty || busy} aria-label={busy ? "发送中" : "发送"}>
                {busy ? "发送中" : "发送"}
              </button>
            )}
          </div>
        </div>
      )}
    </form>
  );
}

export function readImageRef(file: File): Promise<ImageRef> {
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

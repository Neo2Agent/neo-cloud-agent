import type { Run } from "@neo-cloud-agent/contracts/run";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { transcriptGroups } from "@neo-cloud-agent/contracts/transcript";
import type { Ref } from "react";
import { formatDuration } from "../../src/format";
import { messageIsLive, shouldShowAssistantActions, shouldShowThinking } from "../../src/stream";
import { Avatar } from "../Avatar";
import { IconCopy } from "../icons";
import { IslandCollapse } from "../island";
import { ToolCard } from "../ToolCard";

function isThought(message: TranscriptMessage): boolean {
  if (messageIsLive(message) || message.tools?.length || message.blocks?.some((block) => block.type === "tool")) {
    return false;
  }
  const blob = `${message.kind ?? ""} ${message.text}`.toLowerCase();
  return blob.includes("thought") || blob.includes("thinking") || blob.includes("reasoning");
}

function isStatus(message: TranscriptMessage): boolean {
  return message.role === "setup" && !isThought(message);
}

function looksLikeCi(text: string): boolean {
  return /\bci\b|checks completed|github actions|all \d+ (ci )?check/i.test(text);
}

function formatAgo(iso?: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

export function ChatTranscript({
  current,
  visible,
  activity,
  busy,
  user,
  userAvatar,
  neoAvatar,
  feedRef,
  onCopy,
  thinkingHint,
  onOpenDiagnostics,
}: {
  current: Run;
  visible: TranscriptMessage[];
  activity: string | null;
  busy?: boolean;
  user: string;
  userAvatar?: string | null;
  neoAvatar?: string | null;
  feedRef: Ref<HTMLDivElement>;
  onCopy: (text: string) => void;
  thinkingHint?: string;
  onOpenDiagnostics?: () => void;
}) {
  let currentTurnStart = 0;
  for (let index = 0; index < visible.length; index += 1) {
    if (visible[index]?.role === "user") currentTurnStart = index;
  }
  return (
    <div className="feed chat-feed" ref={feedRef}>
      {!visible.some((message) => message.role === "user") ? (
        <article className="msg-row user">
          <div className="chat-col">
            <div className="chat-bubble user">{current.prompt}</div>
          </div>
          <Avatar src={userAvatar} label={user} />
        </article>
      ) : null}
      {visible.map((message, messageIndex) => {
        if (message.role === "user") {
          const sender = message.actorEmail || user;
          return (
            <article id={`msg-${message.id}`} key={message.id} className="msg-row user">
              <div className="chat-col">
                {message.actorEmail && message.actorEmail.toLowerCase() !== user.toLowerCase() ? (
                  <span className="chat-actor">{message.actorEmail}</span>
                ) : null}
                <div className="chat-bubble user">{message.text || current.prompt}</div>
                {message.createdAt ? <span className="chat-time">{formatAgo(message.createdAt)}</span> : null}
                {message.images?.length ? (
                  <div className="thumbs">
                    {message.images.map((image, index) => (
                      <img key={`${message.id}-${index}`} src={`data:${image.mediaType};base64,${image.data}`} alt="" />
                    ))}
                  </div>
                ) : null}
              </div>
              <Avatar
                src={!message.actorEmail || message.actorEmail.toLowerCase() === user.toLowerCase() ? userAvatar : null}
                label={sender}
              />
            </article>
          );
        }
        if (isThought(message)) {
          return (
            <div key={message.id} className="thought">
              <IslandCollapse question="思考过程" answer={<p>{message.text}</p>} />
            </div>
          );
        }
        if (isStatus(message) || looksLikeCi(message.text)) {
          return (
            <p key={message.id} className="status-whisper">
              {message.text}
            </p>
          );
        }
        const groups = transcriptGroups(message);
        const showActions = shouldShowAssistantActions(visible, messageIndex, !busy);
        const live = Boolean(busy) && messageIndex >= currentTurnStart;
        const ago = formatAgo(message.createdAt);
        const duration = formatDuration(message.createdAt, message.updatedAt);
        const showDiag = Boolean(onOpenDiagnostics) && (current.status === "ERROR" || /\berror\b|失败|出错/i.test(message.text));
        const actions = showActions || showDiag || duration || ago ? (
          <div className="assistant-actions">
            {showActions ? (
              <button type="button" className="icon-btn" aria-label="复制" onClick={() => void onCopy(message.text)}>
                <IconCopy />
              </button>
            ) : null}
            {duration ? <span className="ago">{duration}</span> : null}
            {ago ? <span className="ago">{ago}</span> : null}
            {showDiag ? (
              <button type="button" className="crumb-link" onClick={onOpenDiagnostics}>
                查看诊断
              </button>
            ) : null}
          </div>
        ) : null;
        const brand = (
          <div className="chat-brand">
            <Avatar src={neoAvatar} label="Neo" fallback="N" className="neo-avatar" />
            <div className="chat-brand-copy">
              <strong>Neo</strong>
              <span>{live ? activity || "进行中" : "已完成"}</span>
            </div>
          </div>
        );
        if (groups.length === 0) {
          return message.text ? (
            <article id={`msg-${message.id}`} key={message.id} className="msg-row assistant">
              {brand}
              <div className="chat-bubble assistant">
                <div className="assistant-text">{message.text}</div>
              </div>
              {actions}
            </article>
          ) : null;
        }
        return (
          <div id={`msg-${message.id}`} key={message.id} className="msg-row assistant">
            {brand}
            {groups.map((group, index) => {
              if (group.type === "tools") {
                return (
                  <div key={`${message.id}-tools-${index}`} className="tool-stack">
                    {group.tools.map((tool, toolIndex) => (
                      <ToolCard key={tool.id ?? `${tool.name}-${toolIndex}`} tool={tool} />
                    ))}
                  </div>
                );
              }
              return (
                <article key={`${message.id}-text-${index}`} className="chat-bubble assistant">
                  <div className="assistant-text">{group.text}</div>
                </article>
              );
            })}
            {actions}
          </div>
        );
      })}
      {shouldShowThinking(Boolean(busy), visible) ? (
        <div className="turn-progress">
          {thinkingHint ? null : (
            <span className="think-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
          <span>{thinkingHint || activity || "正在思考…"}</span>
        </div>
      ) : null}
    </div>
  );
}

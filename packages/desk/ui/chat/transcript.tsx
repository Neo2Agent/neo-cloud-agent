import type { Run } from "@neo-cloud-agent/contracts/run";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { transcriptGroups } from "@neo-cloud-agent/contracts/transcript";
import type { Ref } from "react";
import { messageIsLive, shouldShowAssistantActions } from "../../src/stream";
import { initials as memberInitials } from "../project/helpers";
import { IconCopy, IconThumbsDown, IconThumbsUp } from "../icons";
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
  user,
  feedRef,
  onCopy,
}: {
  current: Run;
  visible: TranscriptMessage[];
  activity: string | null;
  user: string;
  feedRef: Ref<HTMLDivElement>;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="feed chat-feed" ref={feedRef}>
      {!visible.some((message) => message.role === "user") ? (
        <article className="msg-row user">
          <div className="chat-col">
            <div className="chat-bubble user">{current.prompt}</div>
          </div>
          <span className="avatar">{memberInitials(user)}</span>
        </article>
      ) : null}
      {visible.map((message, messageIndex) => {
        if (message.role === "user") {
          const sender = message.actorEmail || user;
          return (
            <article key={message.id} className="msg-row user">
              <div className="chat-col">
                {message.actorEmail ? <span className="chat-actor">{message.actorEmail}</span> : null}
                <div className="chat-bubble user">{message.text || current.prompt}</div>
                {message.images?.length ? (
                  <div className="thumbs">
                    {message.images.map((image, index) => (
                      <img key={`${message.id}-${index}`} src={`data:${image.mediaType};base64,${image.data}`} alt="" />
                    ))}
                  </div>
                ) : null}
              </div>
              <span className="avatar">{memberInitials(sender)}</span>
            </article>
          );
        }
        if (isThought(message)) {
          return (
            <details key={message.id} className="thought">
              <summary>思考过程</summary>
              <p>{message.text}</p>
            </details>
          );
        }
        if (isStatus(message) || looksLikeCi(message.text)) {
          return (
            <div key={message.id} className={`status-line${looksLikeCi(message.text) ? " ok" : ""}`}>
              <span />
              <p>{message.text}</p>
            </div>
          );
        }
        const groups = transcriptGroups(message);
        const showActions = shouldShowAssistantActions(visible, messageIndex);
        const live = messageIsLive(message) || Boolean(activity && messageIndex === visible.length - 1);
        const actions = showActions ? (
          <div className="assistant-actions">
            <button type="button" className="icon-btn" aria-label="复制" onClick={() => void onCopy(message.text)}>
              <IconCopy />
            </button>
            <button type="button" className="icon-btn" aria-label="有用">
              <IconThumbsUp />
            </button>
            <button type="button" className="icon-btn" aria-label="没用">
              <IconThumbsDown />
            </button>
            <span className="ago">{formatAgo(message.createdAt)}</span>
          </div>
        ) : null;
        const brand = (
          <div className="chat-brand">
            <span className="avatar neo-avatar" aria-hidden="true">
              N
            </span>
            <div className="chat-brand-copy">
              <strong>Neo</strong>
              <span>{live ? activity || "进行中" : `已完成${formatAgo(message.createdAt) ? ` ${formatAgo(message.createdAt)}` : ""}`}</span>
            </div>
          </div>
        );
        if (groups.length === 0) {
          return message.text ? (
            <article key={message.id} className="msg-row assistant">
              {brand}
              <div className="chat-bubble assistant">
                <div className="assistant-text">{message.text}</div>
              </div>
              {actions}
            </article>
          ) : null;
        }
        return (
          <div key={message.id} className="msg-row assistant">
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
      {activity && !visible.some((item) => messageIsLive(item)) ? (
        <div className="turn-progress">
          <span className="think-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>{activity}</span>
        </div>
      ) : null}
    </div>
  );
}

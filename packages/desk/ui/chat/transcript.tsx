import type { Run } from "@neo-cloud-agent/contracts/run";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { transcriptGroups } from "@neo-cloud-agent/contracts/transcript";
import { assistantIsLive } from "@neo-cloud-agent/contracts/turn-state";
import { messageTimeLabel, shouldShowThinking, userMessageAuthor } from "@neo-cloud-agent/contracts/turn-view";
import { partitionTurn } from "@neo-cloud-agent/contracts/work-view";
import { artifactFileName, artifactKindLabel } from "@neo-cloud-agent/contracts/artifact";
import { shouldFollowTranscript } from "@neo-cloud-agent/contracts/display";
import { MarkdownBody } from "@neo-cloud-agent/ui";
import { useLayoutEffect, useRef, type Ref } from "react";
import { shouldShowAssistantActions } from "../../src/stream";
import { IconCopy } from "../icons";
import { WorkFold } from "./WorkFold";

function isThought(message: TranscriptMessage): boolean {
  if (assistantIsLive(message) || message.tools?.length || message.blocks?.some((block) => block.type === "tool")) {
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

export function ChatTranscript({
  current,
  visible,
  activity,
  busy,
  user,
  userId,
  feedRef,
  onCopy,
  thinkingHint,
  onOpenDiagnostics,
  onOpenArtifact,
}: {
  current: Run;
  visible: TranscriptMessage[];
  activity: string | null;
  busy?: boolean;
  user: string;
  userId?: string;
  feedRef: Ref<HTMLDivElement>;
  onCopy: (text: string) => void;
  thinkingHint?: string;
  onOpenDiagnostics?: () => void;
  onOpenArtifact?: (name: string) => void;
}) {
  const viewer = { id: userId, email: user };
  const stick = useRef(true);
  const seenRun = useRef(current.id);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (seenRun.current !== current.id) {
      seenRun.current = current.id;
      stick.current = true;
    }
    const node = nodeRef.current;
    if (!node || !stick.current) return;
    node.scrollTop = node.scrollHeight;
  }, [activity, busy, current.id, visible]);
  let currentTurnStart = 0;
  for (let index = 0; index < visible.length; index += 1) {
    if (visible[index]?.role === "user") currentTurnStart = index;
  }
  return (
    <div
      className="feed chat-feed"
      ref={(node) => {
        nodeRef.current = node;
        if (typeof feedRef === "function") feedRef(node);
        else if (feedRef) (feedRef as { current: HTMLDivElement | null }).current = node;
      }}
      onScroll={() => {
        const node = nodeRef.current;
        if (node) stick.current = shouldFollowTranscript(node);
      }}
    >
      {!visible.some((message) => message.role === "user") ? (
        <article className="msg-row user">
          <div className="chat-col">
            <div className="chat-bubble user">{current.prompt}</div>
          </div>
        </article>
      ) : null}
      {visible.map((message, messageIndex) => {
        if (message.kind === "artifact.uploaded") {
          const name = artifactFileName(message);
          return (
            <article key={message.id} className="artifact">
              <button type="button" className="artifact-chip" onClick={() => onOpenArtifact?.(name)}>
                <span className="artifact-chip-name">{name}</span>
                <span className="chat-time">{artifactKindLabel({ name, contentType: message.mediaType })}</span>
              </button>
            </article>
          );
        }
        if (message.role === "user") {
          const author = userMessageAuthor(message, viewer);
          const when = message.createdAt ? messageTimeLabel(message) : null;
          return (
            <article id={`msg-${message.id}`} key={message.id} className="msg-row user">
              <div className="chat-col">
                {author ? <span className="chat-actor">{author}</span> : null}
                <div className="chat-bubble user">{message.text || current.prompt}</div>
                {when ? <span className="chat-time">{when}</span> : null}
                {message.images?.length ? (
                  <div className="thumbs">
                    {message.images.map((image, index) => (
                      <img key={`${message.id}-${index}`} src={`data:${image.mediaType};base64,${image.data}`} alt="" />
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          );
        }
        if (isThought(message)) {
          return (
            <div key={message.id} className="work-note">
              {message.text}
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
        const turn = partitionTurn(transcriptGroups(message));
        const hasFold = turn.steps.length > 0;
        if (!hasFold && !turn.answer.trim()) return null;
        const live = Boolean(busy) && messageIndex >= currentTurnStart;
        const showActions = shouldShowAssistantActions(visible, messageIndex, !busy);
        const when = messageTimeLabel(message, { live, withDuration: !hasFold });
        const showDiag = Boolean(onOpenDiagnostics) && (current.status === "ERROR" || /\berror\b|失败|出错/i.test(message.text));
        const actions = showActions || showDiag || when ? (
          <div className="assistant-actions">
            {showActions ? (
              <button type="button" className="icon-btn" aria-label="复制" onClick={() => void onCopy(turn.answer || message.text)}>
                <IconCopy />
              </button>
            ) : null}
            {when ? <span className="ago">{when}</span> : null}
            {showDiag ? (
              <button type="button" className="crumb-link" onClick={onOpenDiagnostics}>
                查看诊断
              </button>
            ) : null}
          </div>
        ) : null;
        return (
          <div id={`msg-${message.id}`} key={message.id} className="msg-row assistant">
            <WorkFold turn={turn} live={live} createdAt={message.createdAt} updatedAt={message.updatedAt} />
            {turn.answer.trim() ? (
              <article className="chat-bubble assistant">
                <MarkdownBody text={turn.answer} className="assistant-text" streaming={live && Boolean(message.streaming)} />
              </article>
            ) : null}
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

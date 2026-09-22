import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readSubagentSteps, type SubagentTask } from "@neo-cloud-agent/contracts/subagent";
import { transcriptGroups } from "@neo-cloud-agent/contracts/transcript";
import type { TranscriptMessage, TranscriptTool } from "@neo-cloud-agent/contracts/events";
import type { Recipe } from "@neo-cloud-agent/contracts/recipe";
import { BUNDLED_RECIPES } from "@neo-cloud-agent/contracts/recipe";
import { artifactKind } from "../artifact";
import { fileToolDiff, formatDuration, formatMessageTime, formatWhen, partitionTurn, resolveWorkFoldOpen, toolArgPreview, toolDiffStat, toolVerb } from "../format";
import { IconCheck, IconError, IconFileKind, IconSpinner, IconTool } from "../icons";
import { MarkdownBody } from "../markdown";
import { shouldShowThinking } from "../turn";
import { transcriptUserImageSrc } from "../user-image";
import { withApiBase } from "../desk";

type Props = {
  token?: string;
  messages: TranscriptMessage[];
  remaining: number;
  empty: boolean;
  loading?: boolean;
  loadingOlder?: boolean;
  busy?: boolean;
  activity?: string;
  highlightId?: string | null;
  onLoadOlder: () => void;
  onOpenDiagnostics?: () => void;
  onOpenArtifact?: (name: string) => void;
  onPickRecipe?: (recipe: Recipe) => void;
};

function ToolStatus({ tool }: { tool: TranscriptTool }) {
  if (tool.status === "running") return <IconSpinner size={14} />;
  if (tool.isError) return <IconError size={14} />;
  return <IconCheck size={14} />;
}

function toolDisplayName(tool: TranscriptTool): string {
  const nested = typeof tool.details?.subagent === "string" ? tool.details.subagent : "";
  const verb = toolVerb(tool.name);
  if (nested && tool.name !== "neo_subagent") {
    return `${nested} / ${verb}`;
  }
  return verb;
}

function artifactFileName(message: TranscriptMessage): string {
  const href = message.href ?? "";
  const path = href.split("?")[0] ?? "";
  const raw = path.slice(path.lastIndexOf("/") + 1);
  if (!raw) return message.text.replace(/^已上传\s*/, "").trim() || "产物";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function readSubagentTasks(details?: Record<string, unknown>): SubagentTask[] {
  const raw = details?.tasks;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is SubagentTask => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const record = item as { agent?: unknown; task?: unknown };
    return typeof record.agent === "string" && typeof record.task === "string";
  });
}

function ToolCard({ tool, resetKey }: { tool: TranscriptTool; resetKey: number }) {
  const running = tool.status === "running";
  const preview = toolArgPreview(tool.args);
  const diff = fileToolDiff(tool);
  const stat = toolDiffStat(tool);
  const preRef = useRef<HTMLPreElement>(null);
  const parentSubagent = tool.name === "neo_subagent";
  const subagent = parentSubagent || Boolean(tool.details?.subagent);
  const steps = parentSubagent ? readSubagentSteps(tool.details) : [];
  const tasks = parentSubagent ? readSubagentTasks(tool.details) : [];
  const omitted = parentSubagent ? Number(tool.details?.omittedSteps ?? 0) : 0;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [resetKey]);

  useLayoutEffect(() => {
    if (!running || !preRef.current) return;
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [running, tool.output]);

  return (
    <details
      className={`${tool.isError ? "tool err" : running ? "tool run" : "tool"}${subagent ? " subagent" : ""}`}
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open !== open) setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <span className="tool-name">
          <ToolStatus tool={tool} />
          <IconTool name={tool.name} size={14} />
          {toolDisplayName(tool)}
          <span className="sr-only">{running ? "执行中" : tool.isError ? "失败" : "完成"}</span>
        </span>
        {preview ? <span className="cmd">{preview}</span> : null}
        {stat ? (
          <span className="tool-stat">
            <span className="tool-stat-add">+{stat.added}</span>
            <span className="tool-stat-del">-{stat.removed}</span>
          </span>
        ) : null}
      </summary>
      {tasks.length > 0 ? (
        <ul className="subagent-tasks">
          {tasks.map((task, index) => (
            <li key={`${task.agent}-${index}`}>
              <b>{task.agent}</b> {task.task.replace(/\s+/g, " ").trim()}
            </li>
          ))}
        </ul>
      ) : null}
      {steps.length > 0 ? (
        <ol className="subagent-steps">
          {steps.map((step) => (
            <li
              key={step.id}
              className={step.status === "running" ? "run" : step.isError ? "err" : undefined}
            >
              <span>
                {step.status === "running" ? <IconSpinner size={12} /> : step.isError ? <IconError size={12} /> : <IconCheck size={12} />}{" "}
                {step.agent} / {step.name}
              </span>
              {toolArgPreview(step.args) ? <span className="cmd">{toolArgPreview(step.args)}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {omitted > 0 ? <p className="subagent-more">已折叠 {omitted} 步</p> : null}
      {diff ? (
        <pre className="tool-diff">
          {diff.lines.map((line, index) => (
            <span key={index} className={`diff-${line.type}`}>
              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
              {line.text}
              {"\n"}
            </span>
          ))}
        </pre>
      ) : tool.output ? (
        <pre ref={preRef}>{tool.output}</pre>
      ) : running && steps.length === 0 ? (
        <pre ref={preRef}>执行中…</pre>
      ) : null}
    </details>
  );
}

function MessageTime({ message, className = "" }: { message: TranscriptMessage; className?: string }) {
  const duration =
    message.role === "assistant" && !message.streaming
      ? formatDuration(message.createdAt, message.updatedAt)
      : "";
  return (
    <time className={`bubble-time ${className}`.trim()} dateTime={message.updatedAt || message.createdAt}>
      {formatMessageTime(message.createdAt, message.updatedAt, Boolean(message.streaming))}
      {duration ? ` · ${duration}` : ""}
    </time>
  );
}

function WorkFold({ message }: { message: TranscriptMessage }) {
  const groups = transcriptGroups(message);
  const turn = partitionTurn(groups);
  const streaming = Boolean(message.streaming);
  const [choice, setChoice] = useState<boolean | null>(null);
  const [innerEpoch, setInnerEpoch] = useState(0);
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming) setChoice(null);
    wasStreaming.current = streaming;
  }, [streaming]);
  if (turn.buckets.length === 0 && turn.notes.length === 0) return null;
  const open = resolveWorkFoldOpen(streaming, choice);
  const duration = formatDuration(message.createdAt, message.updatedAt);
  const label = streaming ? "工作中" : duration ? `工作了 ${duration}` : "工作了";
  return (
    <details
      className="work-fold"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next === open) return;
        setChoice(next);
        if (next) setInnerEpoch((epoch) => epoch + 1);
      }}
    >
      <summary>{label}</summary>
      {turn.notes.length > 0 ? (
        <details key={`notes-${innerEpoch}`} className="work-group">
          <summary>过程</summary>
          {turn.notes.map((text, index) => (
            <MarkdownBody key={`${message.id}-note-${index}`} text={text} className="work-note" />
          ))}
        </details>
      ) : null}
      {turn.buckets.map((bucket) => (
        <details key={`${bucket.id}-${innerEpoch}`} className="work-group">
          <summary>{bucket.label}</summary>
          {bucket.tools.map((tool, toolIndex) => (
            <ToolCard key={tool.id ?? `${tool.name}-${toolIndex}`} tool={tool} resetKey={innerEpoch} />
          ))}
        </details>
      ))}
    </details>
  );
}

function ArtifactCard({ message, onOpen }: { message: TranscriptMessage; onOpen?: (name: string) => void }) {
  const name = artifactFileName(message);
  const kind = artifactKind({ name, contentType: message.mediaType });
  return (
    <article className="artifact">
      <button type="button" className="artifact-chip" onClick={() => onOpen?.(name)}>
        <IconFileKind kind={kind} size={16} />
        <span className="artifact-chip-name">{name}</span>
      </button>
    </article>
  );
}

export function Transcript({
  token = "",
  messages,
  remaining,
  empty,
  loading = false,
  loadingOlder = false,
  busy = false,
  activity,
  highlightId,
  onLoadOlder,
  onOpenDiagnostics,
  onOpenArtifact,
  onPickRecipe,
}: Props) {
  const scroller = useRef<HTMLElement>(null);
  const stick = useRef(true);
  const restore = useRef<{ height: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const pending = restore.current;
    if (pending) {
      node.scrollTop = pending.top + (node.scrollHeight - pending.height);
      restore.current = null;
      return;
    }
    if (stick.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, remaining, busy, activity, loading]);

  useEffect(() => {
    if (!highlightId) return;
    document.getElementById(`msg-${highlightId}`)?.scrollIntoView({ block: "center" });
  }, [highlightId]);

  const loadOlder = () => {
    if (remaining <= 0 || loadingOlder || restore.current) return;
    const node = scroller.current;
    if (node) restore.current = { height: node.scrollHeight, top: node.scrollTop };
    onLoadOlder();
  };

  return (
    <section
      className="transcript"
      id="transcript"
      aria-live={busy ? "off" : "polite"}
      aria-busy={busy || loading}
      ref={scroller}
      onScroll={() => {
        const node = scroller.current;
        if (!node) return;
        stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
        if (node.scrollTop < 48) loadOlder();
      }}
    >
      <div className="transcript-col">
        {remaining > 0 ? (
          <div className="history-more" id="history-more">
            <button type="button" id="load-older" disabled={loadingOlder} onClick={loadOlder}>
              {loadingOlder ? "正在加载…" : `加载更早的消息（还有 ${remaining} 条）`}
            </button>
          </div>
        ) : null}
        {loading ? (
          <div className="transcript-skel" aria-hidden="true">
            <div className="skel skel-user" />
            <div className="skel skel-ai" />
            <div className="skel skel-ai short" />
          </div>
        ) : null}
        {empty ? (
          <div className="empty">
            <h2>有什么可以帮你的？</h2>
            <p>发送后会占用一台云端电脑。也可以先点一张做法再改。仓库和 API Key 在「设置」里。</p>
            {onPickRecipe ? (
              <ul className="recipe-grid">
                {BUNDLED_RECIPES.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="recipe-card" onClick={() => onPickRecipe(item)}>
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          messages.map((message) => {
            if (message.kind === "artifact.uploaded") {
              return <ArtifactCard key={message.id} message={message} onOpen={onOpenArtifact} />;
            }
            if (message.role === "setup") {
              const failed = message.level === "error" || String(message.kind).endsWith("_failed") || message.kind === "run.error";
              return (
                <p
                  key={message.id}
                  id={`msg-${message.id}`}
                  className={failed ? "setup err" : "setup"}
                  data-highlight={highlightId === message.id ? "true" : undefined}
                >
                  <span>{message.text}</span>
                  {failed && onOpenDiagnostics ? (
                    <button type="button" className="ghost diag-link" onClick={onOpenDiagnostics}>
                      查看诊断
                    </button>
                  ) : null}
                  <time className="bubble-time setup-time" dateTime={message.createdAt}>
                    {formatWhen(message.createdAt)}
                  </time>
                </p>
              );
            }
            if (message.role === "user") {
              return (
                <article
                  key={message.id}
                  id={`msg-${message.id}`}
                  className="bubble user"
                  data-highlight={highlightId === message.id ? "true" : undefined}
                >
                  {message.text ? <div className="body">{message.text}</div> : null}
                  {message.images?.length ? (
                    <div className="image-row">
                      {message.images.map((image, index) => {
                        const src = transcriptUserImageSrc(image, token, withApiBase);
                        return src ? (
                          <img
                            key={`${message.id}-${index}`}
                            className="user-image"
                            src={src}
                            alt=""
                            decoding="async"
                          />
                        ) : null;
                      })}
                    </div>
                  ) : null}
                  <MessageTime message={message} />
                </article>
              );
            }
            const turn = partitionTurn(transcriptGroups(message));
            if (turn.buckets.length === 0 && turn.notes.length === 0 && !turn.answer) {
              return null;
            }
            return (
              <Fragment key={message.id}>
                <WorkFold message={message} />
                {turn.answer ? (
                  <article
                    id={`msg-${message.id}`}
                    className="bubble assistant"
                    data-highlight={highlightId === message.id ? "true" : undefined}
                  >
                    <MarkdownBody text={turn.answer} className="body" streaming={Boolean(message.streaming)} />
                    <MessageTime message={message} />
                  </article>
                ) : (
                  <MessageTime message={message} className="assistant-time" />
                )}
              </Fragment>
            );
          })
        )}
        {shouldShowThinking(busy, messages) && !empty && !loading ? (
          <div className="turn-progress" id="turn-progress">
            <div className="think-line">
              <span className="think-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>{activity || "正在思考…"}</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

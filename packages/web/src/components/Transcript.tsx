import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { readSubagentSteps, type SubagentTask } from "@neo-cloud-agent/contracts/subagent";
import { transcriptGroups } from "@neo-cloud-agent/contracts/transcript";
import { currentTurnMessages, liveAssistantId } from "@neo-cloud-agent/contracts/turn-state";
import type { TranscriptMessage, TranscriptTool } from "@neo-cloud-agent/contracts/events";
import type { Recipe } from "@neo-cloud-agent/contracts/recipe";
import { BUNDLED_RECIPES } from "@neo-cloud-agent/contracts/recipe";
import { artifactKind } from "../artifact";
import {
  fileCardPreview,
  formatDuration,
  formatMessageTime,
  formatWhen,
  partitionTurn,
  previewWorkTools,
  resolveFoldOpen,
  toolArgPreview,
  toolChromeKind,
  toolDiffStat,
  toolLinkLabel,
  toolVerb,
  workGroupLabel,
} from "../format";
import { IconCheck, IconChevronRight, IconError, IconFileKind, IconSpinner, IconTool } from "../icons";
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

function WorkChevron() {
  return <IconChevronRight size={12} className="work-chevron" />;
}

/**
 * A click sticks for the whole turn, and a section that auto-opened stays open while the turn
 * is live. Both clear once, when the turn settles.
 */
function useTurnDisclosure(live: boolean, autoOpen = false): [boolean, () => void] {
  const [choice, setChoice] = useState<boolean | null>(null);
  const [latched, setLatched] = useState(autoOpen);
  const wasLive = useRef(live);
  useEffect(() => {
    if (autoOpen) setLatched(true);
  }, [autoOpen]);
  useEffect(() => {
    if (wasLive.current && !live) {
      setChoice(null);
      setLatched(false);
    }
    wasLive.current = live;
  }, [live]);
  const open = resolveFoldOpen(autoOpen || latched, choice);
  return [open, () => setChoice(!open)];
}

function ToolFileBody({ tool }: { tool: TranscriptTool }) {
  const card = fileCardPreview(tool);
  const path = card?.path || toolArgPreview(tool.args);
  if (!card) {
    return (
      <div className="tool-file">
        {path ? <div className="tool-file-bar">{path}</div> : null}
        <p className="tool-file-more">{tool.status === "running" ? "执行中…" : "没有可预览的改动"}</p>
      </div>
    );
  }
  return (
    <div className="tool-file">
      {path ? <div className="tool-file-bar">{path}</div> : null}
      <div className="tool-file-diff">
        {card.lines.map((line, index) => (
          <div key={index} className={`diff-${line.type}`}>
            {line.text || "\u00a0"}
          </div>
        ))}
      </div>
      {card.hidden > 0 ? <p className="tool-file-more">还有 {card.hidden} 行</p> : null}
    </div>
  );
}

function ToolTermBody({ tool }: { tool: TranscriptTool }) {
  const running = tool.status === "running";
  const command = toolArgPreview(tool.args);
  const output = tool.output || (running ? "执行中…" : "");
  const preRef = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (!running || !preRef.current) return;
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [running, tool.output]);
  return (
    <div className="tool-term">
      {command ? <div className="tool-term-cmd">{`$ ${command}`}</div> : null}
      {output ? <pre ref={preRef}>{output}</pre> : null}
    </div>
  );
}

function ToolLink({ tool, live }: { tool: TranscriptTool; live: boolean }) {
  const running = tool.status === "running";
  const label = toolLinkLabel(tool);
  const [open, toggle] = useTurnDisclosure(live);
  const output = tool.output || (running ? "执行中…" : "");
  return (
    <div className={`tool-link-row${open ? " is-open" : ""}${tool.isError ? " err" : running ? " run" : ""}`}>
      <button type="button" className="tool-link" aria-expanded={open} onClick={toggle}>
        <WorkChevron />
        <ToolStatus tool={tool} />
        <span className="tool-link-text">{label}</span>
      </button>
      {open && output ? <pre className="tool-link-out">{output}</pre> : null}
    </div>
  );
}

function ToolCard({ tool, live }: { tool: TranscriptTool; live: boolean }) {
  const running = tool.status === "running";
  const preview = toolArgPreview(tool.args);
  const kind = toolChromeKind(tool.name);
  const stat = kind === "file" ? toolDiffStat(tool) : null;
  const parentSubagent = tool.name === "neo_subagent";
  const subagent = parentSubagent || Boolean(tool.details?.subagent);
  const steps = parentSubagent ? readSubagentSteps(tool.details) : [];
  const tasks = parentSubagent ? readSubagentTasks(tool.details) : [];
  const omitted = parentSubagent ? Number(tool.details?.omittedSteps ?? 0) : 0;
  const [open, toggle] = useTurnDisclosure(live, live && kind === "term" && running);

  return (
    <div className={`${tool.isError ? "tool err" : running ? "tool run" : "tool"}${subagent ? " subagent" : ""}${open ? " is-open" : ""}`}>
      <button type="button" className="tool-sum" aria-expanded={open} onClick={toggle}>
        <WorkChevron />
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
      </button>
      {open ? (
        <div className="tool-body">
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
          {kind === "file" ? (
            <ToolFileBody tool={tool} />
          ) : kind === "term" ? (
            <ToolTermBody tool={tool} />
          ) : tool.output ? (
            <pre>{tool.output}</pre>
          ) : running && steps.length === 0 ? (
            <pre>执行中…</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MessageTime({
  message,
  live = false,
  withDuration = true,
  className = "",
}: {
  message: TranscriptMessage;
  live?: boolean;
  withDuration?: boolean;
  className?: string;
}) {
  const duration =
    message.role === "assistant" && !live && withDuration ? formatDuration(message.createdAt, message.updatedAt) : "";
  return (
    <time className={`bubble-time ${className}`.trim()} dateTime={message.updatedAt || message.createdAt}>
      {formatMessageTime(message.createdAt, message.updatedAt, live)}
      {duration ? ` · ${duration}` : ""}
    </time>
  );
}

function currentTurnHasWorkFold(messages: TranscriptMessage[]): boolean {
  return currentTurnMessages(messages).some((message) => {
    if (message.role !== "assistant") return false;
    const part = partitionTurn(transcriptGroups(message));
    return part.notes.length > 0 || part.buckets.length > 0;
  });
}

function WorkGroup({
  label,
  live,
  autoOpen = false,
  children,
}: {
  label: string;
  live: boolean;
  autoOpen?: boolean;
  children: ReactNode;
}) {
  const [open, toggle] = useTurnDisclosure(live, autoOpen);
  return (
    <div className={`work-group${open ? " is-open" : ""}`}>
      <button type="button" className="work-sum" aria-expanded={open} onClick={toggle}>
        <span>{label}</span>
        <WorkChevron />
      </button>
      <div className="work-fold-body" aria-hidden={!open}>
        <div className="work-fold-body-inner">{children}</div>
      </div>
    </div>
  );
}

/** Distance from the bottom that still counts as following the live list. */
const WORK_LIST_STICK_PX = 24;

function WorkToolList({ tools, live }: { tools: TranscriptTool[]; live: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!live || !stick.current || !node) return;
    node.scrollTop = node.scrollHeight;
  }, [live, tools]);
  const { shown, hidden } = live || expanded ? { shown: tools, hidden: 0 } : previewWorkTools(tools);
  const offset = tools.length - shown.length;
  return (
    <>
      {hidden > 0 ? (
        <button type="button" className="work-more" onClick={() => setExpanded(true)}>
          还有 {hidden} 步
        </button>
      ) : null}
      <div
        ref={scroller}
        className={live ? "work-tools is-live" : "work-tools"}
        onScroll={() => {
          const node = scroller.current;
          if (node) stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < WORK_LIST_STICK_PX;
        }}
      >
        {shown.map((tool, toolIndex) => {
          const key = tool.id ?? `${tool.name}-${offset + toolIndex}`;
          return toolChromeKind(tool.name) === "link" ? (
            <ToolLink key={key} tool={tool} live={live} />
          ) : (
            <ToolCard key={key} tool={tool} live={live} />
          );
        })}
      </div>
    </>
  );
}

function WorkFold({ message, live }: { message: TranscriptMessage; live: boolean }) {
  const turn = partitionTurn(transcriptGroups(message));
  const [open, toggle] = useTurnDisclosure(live, live);
  if (turn.buckets.length === 0 && turn.notes.length === 0) return null;
  const duration = live ? "" : formatDuration(message.createdAt, message.updatedAt);
  const label = live ? "工作中" : duration ? `工作了 ${duration}` : "工作了";
  const liveFamily = live
    ? [...turn.buckets].reverse().find((bucket) => bucket.tools.some((tool) => tool.status === "running"))?.id
    : undefined;
  return (
    <div className={`work-fold${open ? " is-open" : ""}`}>
      <button type="button" className="work-sum" aria-expanded={open} onClick={toggle}>
        <span>{label}</span>
        <WorkChevron />
      </button>
      <div className="work-fold-body" aria-hidden={!open}>
        <div className="work-fold-body-inner">
          {turn.notes.length > 0 ? (
            <WorkGroup key="notes" label={duration ? `想了 ${duration}` : "想了"} live={live}>
              {turn.notes.map((text, index) => (
                <MarkdownBody key={`${message.id}-note-${index}`} text={text} className="work-note" />
              ))}
            </WorkGroup>
          ) : null}
          {turn.buckets.map((bucket) => (
            <WorkGroup
              key={bucket.id}
              label={workGroupLabel(bucket.id, bucket.tools)}
              live={live}
              autoOpen={liveFamily === bucket.id}
            >
              <WorkToolList tools={bucket.tools} live={live} />
            </WorkGroup>
          ))}
        </div>
      </div>
    </div>
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
  const liveId = liveAssistantId(messages, busy);

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
            const hasFold = turn.buckets.length > 0 || turn.notes.length > 0;
            if (!hasFold && !turn.answer) {
              return null;
            }
            const live = message.id === liveId;
            return (
              <Fragment key={message.id}>
                <WorkFold message={message} live={live} />
                {turn.answer ? (
                  <article
                    id={`msg-${message.id}`}
                    className="bubble assistant"
                    data-highlight={highlightId === message.id ? "true" : undefined}
                  >
                    <MarkdownBody text={turn.answer} className="body" streaming={Boolean(message.streaming)} />
                    <MessageTime message={message} live={live} withDuration={!hasFold} />
                  </article>
                ) : (
                  <MessageTime message={message} live={live} withDuration={!hasFold} className="assistant-time" />
                )}
              </Fragment>
            );
          })
        )}
        {shouldShowThinking(busy, messages) && !empty && !loading && !currentTurnHasWorkFold(messages) ? (
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

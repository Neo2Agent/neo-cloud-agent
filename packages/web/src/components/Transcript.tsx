import { Fragment, useLayoutEffect, useRef } from "react";
import { readSubagentSteps, type SubagentTask } from "@neo-cloud-agent/contracts/subagent";
import { transcriptGroups } from "@neo-cloud-agent/contracts/transcript";
import type { TranscriptMessage, TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { fileToolDiff, formatMessageTime, formatWhen, toolArgPreview } from "../format";
import { IconCheck, IconError, IconSpinner, IconTool } from "../icons";
import { MarkdownBody } from "../markdown";
import { shouldShowThinking } from "../turn";

const STARTER_PROMPTS = [
  { title: "看仓库", prompt: "看看仓库结构，总结怎么跑起来。" },
  { title: "加 README", prompt: "加个 README.md 并跑测试。" },
  { title: "修类型", prompt: "找出类型错误并修掉。" },
  { title: "开草稿 PR", prompt: "把这次改动整理成草稿 PR。" },
];

type Props = {
  messages: TranscriptMessage[];
  remaining: number;
  empty: boolean;
  loading?: boolean;
  loadingOlder?: boolean;
  busy?: boolean;
  activity?: string;
  onLoadOlder: () => void;
  onPickPrompt?: (prompt: string) => void;
};

function ToolStatus({ tool }: { tool: TranscriptTool }) {
  if (tool.status === "running") return <IconSpinner size={14} />;
  if (tool.isError) return <IconError size={14} />;
  return <IconCheck size={14} />;
}

function toolDisplayName(tool: TranscriptTool): string {
  const nested = typeof tool.details?.subagent === "string" ? tool.details.subagent : "";
  if (nested && tool.name !== "neo_subagent") {
    return `${nested} / ${tool.name}`;
  }
  return tool.name === "neo_subagent" ? "subagent" : tool.name;
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

function ToolCard({ tool }: { tool: TranscriptTool }) {
  const running = tool.status === "running" && !tool.output;
  const preview = toolArgPreview(tool.args);
  const diff = fileToolDiff(tool);
  const preRef = useRef<HTMLPreElement>(null);
  const parentSubagent = tool.name === "neo_subagent";
  const subagent = parentSubagent || Boolean(tool.details?.subagent);
  const steps = parentSubagent ? readSubagentSteps(tool.details) : [];
  const tasks = parentSubagent ? readSubagentTasks(tool.details) : [];
  const omitted = parentSubagent ? Number(tool.details?.omittedSteps ?? 0) : 0;

  useLayoutEffect(() => {
    if (!running || !preRef.current) return;
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [running, tool.output]);

  return (
    <details
      className={`${tool.isError ? "tool err" : running ? "tool run" : "tool"}${subagent ? " subagent" : ""}`}
      open={running}
    >
      <summary>
        <span className="tool-name">
          <ToolStatus tool={tool} />
          <IconTool name={tool.name} size={14} />
          {toolDisplayName(tool)}
        </span>
        {preview ? <span className="cmd">{preview}</span> : null}
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
      ) : null}
      {tool.output ? (
        <pre ref={preRef}>{tool.output}</pre>
      ) : running && !diff && steps.length === 0 ? (
        <pre ref={preRef}>执行中…</pre>
      ) : null}
    </details>
  );
}

function MessageTime({ message, className = "" }: { message: TranscriptMessage; className?: string }) {
  return (
    <time className={`bubble-time ${className}`.trim()} dateTime={message.updatedAt || message.createdAt}>
      {formatMessageTime(message.createdAt, message.updatedAt, Boolean(message.streaming))}
    </time>
  );
}

function ArtifactCard({ message }: { message: TranscriptMessage }) {
  const href = message.href;
  const image = Boolean(href && message.mediaType?.startsWith("image/"));
  return (
    <article className="artifact">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {message.text}
        </a>
      ) : (
        <span>{message.text}</span>
      )}
      {image && href ? <img src={href} alt="" /> : null}
    </article>
  );
}

export function Transcript({
  messages,
  remaining,
  empty,
  loading = false,
  loadingOlder = false,
  busy = false,
  activity,
  onLoadOlder,
  onPickPrompt,
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
            <p>发送后会占用一台云端电脑。仓库和 API Key 在「设置」里。</p>
            {onPickPrompt ? (
              <div className="empty-grid">
                {STARTER_PROMPTS.map((item) => (
                  <button key={item.title} type="button" className="empty-card" onClick={() => onPickPrompt(item.prompt)}>
                    <strong>{item.title}</strong>
                    <span>{item.prompt}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          messages.map((message) => {
            if (message.kind === "artifact.uploaded") {
              return <ArtifactCard key={message.id} message={message} />;
            }
            if (message.role === "setup") {
              return (
                <p key={message.id} className={message.level === "error" || String(message.kind).endsWith("_failed") ? "setup err" : "setup"}>
                  <span>{message.text}</span>
                  <time className="bubble-time setup-time" dateTime={message.createdAt}>
                    {formatWhen(message.createdAt)}
                  </time>
                </p>
              );
            }
            if (message.role === "user") {
              return (
                <article key={message.id} className="bubble user">
                  {message.text ? <div className="body">{message.text}</div> : null}
                  {message.images?.length ? (
                    <div className="image-row">
                      {message.images.map((image, index) => (
                        <img
                          key={`${message.id}-${index}`}
                          className="user-image"
                          src={`data:${image.mediaType};base64,${image.data}`}
                          alt=""
                        />
                      ))}
                    </div>
                  ) : null}
                  <MessageTime message={message} />
                </article>
              );
            }
            const groups = transcriptGroups(message);
            if (groups.length === 0) {
              return null;
            }
            return (
              <Fragment key={message.id}>
                {groups.map((group, index) => {
                  const last = index === groups.length - 1;
                  if (group.type === "tools") {
                    return (
                      <Fragment key={`${message.id}-tools-${index}`}>
                        <div className="tool-stack">
                          {group.tools.map((tool, toolIndex) => (
                            <ToolCard key={tool.id ?? `${tool.name}-${toolIndex}`} tool={tool} />
                          ))}
                        </div>
                        {last ? <MessageTime message={message} className="assistant-time" /> : null}
                      </Fragment>
                    );
                  }
                  const lastText = !groups.slice(index + 1).some((item) => item.type === "text");
                  return (
                    <article key={`${message.id}-text-${index}`} className="bubble assistant">
                      <MarkdownBody
                        text={group.text}
                        className="body"
                        streaming={Boolean(message.streaming && lastText)}
                      />
                      {last ? <MessageTime message={message} /> : null}
                    </article>
                  );
                })}
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

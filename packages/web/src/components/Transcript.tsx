import { Fragment, useLayoutEffect, useRef } from "react";
import { transcriptGroups } from "@neo-cloud-agent/contracts/transcript";
import type { TranscriptMessage, TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { fileToolDiff, toolArgPreview } from "../format";
import { MarkdownBody } from "../markdown";
import { shouldShowThinking } from "../turn";

type Props = {
  messages: TranscriptMessage[];
  remaining: number;
  empty: boolean;
  busy?: boolean;
  activity?: string;
  onLoadOlder: () => void;
};

function toolMark(tool: TranscriptTool): string {
  if (tool.status === "running") return "…";
  return tool.isError ? "✗" : "✓";
}

function ToolCard({ tool }: { tool: TranscriptTool }) {
  const running = tool.status === "running";
  const preview = toolArgPreview(tool.args);
  const diff = fileToolDiff(tool);
  const preRef = useRef<HTMLPreElement>(null);

  useLayoutEffect(() => {
    if (!running || !preRef.current) return;
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [running, tool.output]);

  return (
    <details
      className={tool.isError ? "tool err" : running ? "tool run" : "tool"}
      open={running || Boolean(tool.output) || Boolean(preview) || Boolean(diff)}
    >
      <summary>
        <span>
          {toolMark(tool)} {tool.name}
        </span>
        {preview ? <span className="cmd">{preview}</span> : null}
      </summary>
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
      {tool.output ? <pre ref={preRef}>{tool.output}</pre> : running && !diff ? <pre ref={preRef}>执行中…</pre> : null}
    </details>
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

export function Transcript({ messages, remaining, empty, busy = false, activity, onLoadOlder }: Props) {
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
  }, [messages, remaining, busy, activity]);

  const loadOlder = () => {
    if (remaining <= 0 || restore.current) return;
    const node = scroller.current;
    if (node) restore.current = { height: node.scrollHeight, top: node.scrollTop };
    onLoadOlder();
  };

  return (
    <section
      className="transcript"
      id="transcript"
      aria-live={busy ? "off" : "polite"}
      aria-busy={busy}
      ref={scroller}
      onScroll={() => {
        const node = scroller.current;
        if (!node) return;
        stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
        if (node.scrollTop < 48) loadOlder();
      }}
    >
      {remaining > 0 ? (
        <div className="history-more" id="history-more">
          <button type="button" id="load-older" onClick={loadOlder}>
            加载更早的消息（还有 {remaining} 条）
          </button>
        </div>
      ) : null}
      {empty ? (
        <div className="empty">
          <h2>直接说要做什么</h2>
          <p>发送后会占用一个空闲 VM。仓库和 API Key 在右上角「设置」里。</p>
        </div>
      ) : (
        messages.map((message) => {
          if (message.kind === "artifact.uploaded") {
            return <ArtifactCard key={message.id} message={message} />;
          }
          if (message.role === "setup") {
            return (
              <p key={message.id} className={message.level === "error" || String(message.kind).endsWith("_failed") ? "setup err" : "setup"}>
                {message.text}
              </p>
            );
          }
          if (message.role === "user") {
            return (
              <article key={message.id} className="bubble user">
                <span className="who">你</span>
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
                if (group.type === "tools") {
                  return (
                    <div key={`${message.id}-tools-${index}`} className="tool-stack">
                      <span className="who">工具</span>
                      {group.tools.map((tool, toolIndex) => (
                        <ToolCard key={tool.id ?? `${tool.name}-${toolIndex}`} tool={tool} />
                      ))}
                    </div>
                  );
                }
                const lastText = !groups.slice(index + 1).some((item) => item.type === "text");
                return (
                  <article key={`${message.id}-text-${index}`} className="bubble assistant">
                    <span className="who">Agent</span>
                    <MarkdownBody
                      text={group.text}
                      className="body"
                      streaming={Boolean(message.streaming && lastText)}
                    />
                  </article>
                );
              })}
            </Fragment>
          );
        })
      )}
      {shouldShowThinking(busy, messages) && !empty ? (
        <div className="turn-progress" id="turn-progress">
          <span className="who">Agent</span>
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
    </section>
  );
}

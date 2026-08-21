import { useLayoutEffect, useRef } from "react";
import type { TranscriptMessage, TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { toolArgPreview } from "../format";

type Props = {
  messages: TranscriptMessage[];
  remaining: number;
  empty: boolean;
  onLoadOlder: () => void;
};

function toolMark(tool: TranscriptTool): string {
  if (tool.status === "running") return "…";
  return tool.isError ? "✗" : "✓";
}

function ToolCard({ tool }: { tool: TranscriptTool }) {
  const running = tool.status === "running";
  const preview = toolArgPreview(tool.args);
  return (
    <details className={tool.isError ? "tool err" : "tool"} open={running || Boolean(tool.output) || Boolean(preview)}>
      <summary>
        <span>
          {toolMark(tool)} {tool.name}
        </span>
        {preview ? <span className="cmd">{preview}</span> : null}
      </summary>
      {tool.output ? <pre>{tool.output}</pre> : running ? <pre>执行中…</pre> : null}
    </details>
  );
}

export function Transcript({ messages, remaining, empty, onLoadOlder }: Props) {
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
  }, [messages, remaining]);

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
      aria-live="polite"
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
                <div className="body">{message.text}</div>
              </article>
            );
          }
          if (!message.text && !(message.tools && message.tools.length > 0)) {
            return null;
          }
          return (
            <article key={message.id} className="bubble assistant">
              <span className="who">Agent</span>
              {message.text ? <div className="body">{message.text}</div> : null}
              {(message.tools ?? []).map((tool, index) => (
                <ToolCard key={tool.id ?? `${tool.name}-${index}`} tool={tool} />
              ))}
            </article>
          );
        })
      )}
    </section>
  );
}

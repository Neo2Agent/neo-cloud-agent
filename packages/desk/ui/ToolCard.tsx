import { readSubagentSteps, type SubagentTask } from "@neo-cloud-agent/contracts/subagent";
import type { TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { toolArgPreview } from "@neo-cloud-agent/contracts/display";
import {
  fileCardPreview,
  toolChromeKind,
  toolDiffStat,
  toolLinkLabel,
  toolVerb,
} from "@neo-cloud-agent/contracts/work-view";
import { useLayoutEffect, useRef, useState } from "react";
import { IconCheck, IconChevron, IconError, IconSpinner, IconTool } from "./icons";
import { useTurnDisclosure } from "./chat/use-turn-disclosure";

function ToolStatus({ tool }: { tool: TranscriptTool }) {
  if (tool.status === "running") return <IconSpinner size={14} className="spin" />;
  if (tool.isError) return <IconError size={14} />;
  return <IconCheck size={14} />;
}

function toolDisplayName(tool: TranscriptTool): string {
  const nested = typeof tool.details?.subagent === "string" ? tool.details.subagent : "";
  const verb = toolVerb(tool.name);
  if (nested && tool.name !== "neo_subagent") return `${nested} / ${verb}`;
  return verb;
}

function readSubagentTasks(details?: Record<string, unknown>): SubagentTask[] {
  const raw = details?.tasks;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is SubagentTask => {
    if (!item || typeof item !== "object") return false;
    const record = item as { agent?: unknown; task?: unknown };
    return typeof record.agent === "string" && typeof record.task === "string";
  });
}

function ToolFileBody({ tool }: { tool: TranscriptTool }) {
  const [full, setFull] = useState(false);
  const card = fileCardPreview(tool, { full });
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
      <div className={full ? "tool-file-diff is-full" : "tool-file-diff"}>
        {card.lines.map((line, index) => (
          <div key={index} className={`diff-${line.type}`}>
            {line.text || "\u00a0"}
          </div>
        ))}
      </div>
      {card.hidden > 0 || full ? (
        <button type="button" className="tool-file-more" aria-expanded={full} onClick={() => setFull((value) => !value)}>
          {full ? "收起" : `还有 ${card.hidden} 行，展开全部`}
        </button>
      ) : null}
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

export function ToolLink({ tool, live }: { tool: TranscriptTool; live: boolean }) {
  const running = tool.status === "running";
  const label = toolLinkLabel(tool);
  const [open, toggle] = useTurnDisclosure(live);
  const output = tool.output || (running ? "执行中…" : "");
  return (
    <div className={`tool-link-row${open ? " is-open" : ""}${tool.isError ? " err" : running ? " run" : ""}`}>
      <button type="button" className="tool-link" aria-expanded={open} onClick={toggle}>
        <IconChevron size={12} className="work-chevron" />
        <ToolStatus tool={tool} />
        <span className="tool-link-text">{label}</span>
      </button>
      <div className="work-fold-body" aria-hidden={!open}>
        <div className="work-fold-body-inner">{output ? <pre className="tool-link-out">{output}</pre> : null}</div>
      </div>
    </div>
  );
}

export function ToolCard({ tool, live }: { tool: TranscriptTool; live: boolean }) {
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
        <IconChevron size={12} className="work-chevron" />
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
      <div className="work-fold-body" aria-hidden={!open}>
        <div className="work-fold-body-inner">
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
                  <li key={step.id} className={step.status === "running" ? "run" : step.isError ? "err" : undefined}>
                    <span>
                      {step.status === "running" ? <IconSpinner size={12} className="spin" /> : step.isError ? <IconError size={12} /> : <IconCheck size={12} />}{" "}
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
        </div>
      </div>
    </div>
  );
}

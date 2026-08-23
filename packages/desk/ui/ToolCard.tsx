import { readSubagentSteps } from "@neo-cloud-agent/contracts/subagent";
import type { TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { useLayoutEffect, useRef } from "react";
import { toolArgPreview } from "../src/format";

function toolMark(tool: TranscriptTool): string {
  if (tool.status === "running") return "…";
  return tool.isError ? "✗" : "✓";
}

function toolDisplayName(tool: TranscriptTool): string {
  const nested = typeof tool.details?.subagent === "string" ? tool.details.subagent : "";
  if (nested && tool.name !== "neo_subagent") {
    return `${nested} / ${tool.name}`;
  }
  return tool.name === "neo_subagent" ? "subagent" : tool.name;
}

export function ToolCard({ tool }: { tool: TranscriptTool }) {
  const running = tool.status === "running" && !tool.output;
  const preview = toolArgPreview(tool.args);
  const preRef = useRef<HTMLPreElement>(null);
  const parentSubagent = tool.name === "neo_subagent";
  const subagent = parentSubagent || Boolean(tool.details?.subagent);
  const steps = parentSubagent ? readSubagentSteps(tool.details) : [];
  const omitted = parentSubagent ? Number(tool.details?.omittedSteps ?? 0) : 0;

  useLayoutEffect(() => {
    if (!running || !preRef.current) return;
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [running, tool.output]);

  return (
    <details className={`${tool.isError ? "tool err" : running ? "tool run" : "tool"}${subagent ? " subagent" : ""}`} open={running}>
      <summary>
        <span>
          {toolMark(tool)} {toolDisplayName(tool)}
        </span>
        {preview ? <span className="cmd">{preview}</span> : null}
      </summary>
      {steps.length > 0 ? (
        <ol className="subagent-steps">
          {steps.map((step) => (
            <li key={step.id} className={step.status === "running" ? "run" : step.isError ? "err" : undefined}>
              <span>
                {step.status === "running" ? "…" : step.isError ? "✗" : "✓"} {step.agent} / {step.name}
              </span>
              {toolArgPreview(step.args) ? <span className="cmd">{toolArgPreview(step.args)}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {omitted > 0 ? <p className="subagent-more">已折叠 {omitted} 步</p> : null}
      {tool.output ? (
        <pre ref={preRef}>{tool.output}</pre>
      ) : running && steps.length === 0 ? (
        <pre ref={preRef}>执行中…</pre>
      ) : null}
    </details>
  );
}

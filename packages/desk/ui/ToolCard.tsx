import { readSubagentSteps } from "@neo-cloud-agent/contracts/subagent";
import type { TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { toolArgPreview } from "../src/format";
import { IslandTag } from "./island";

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

function ToolBody({ tool, running }: { tool: TranscriptTool; running: boolean }) {
  const preRef = useRef<HTMLPreElement>(null);
  const parentSubagent = tool.name === "neo_subagent";
  const steps = parentSubagent ? readSubagentSteps(tool.details) : [];
  const omitted = parentSubagent ? Number(tool.details?.omittedSteps ?? 0) : 0;

  useLayoutEffect(() => {
    if (!running || !preRef.current) return;
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [running, tool.output]);

  return (
    <>
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
    </>
  );
}

function ToolHead({ tool }: { tool: TranscriptTool }) {
  const preview = toolArgPreview(tool.args);
  const color = tool.isError ? "app-red" : tool.status === "running" ? "app-teal" : "app-green";
  return (
    <div className="tool-head">
      <IslandTag color={color}>
        {toolMark(tool)} {toolDisplayName(tool)}
      </IslandTag>
      {preview ? <span className="cmd">{preview}</span> : null}
    </div>
  );
}

export function ToolCard({ tool }: { tool: TranscriptTool }) {
  const running = tool.status === "running";
  const parentSubagent = tool.name === "neo_subagent";
  const subagent = parentSubagent || Boolean(tool.details?.subagent);
  const className = `${tool.isError ? "tool err" : running ? "tool run" : "tool"}${subagent ? " subagent" : ""}`;
  const body: ReactNode = <ToolBody tool={tool} running={running} />;

  if (running) {
    return (
      <div className={className}>
        <ToolHead tool={tool} />
        {body}
      </div>
    );
  }

  return (
    <details className={className}>
      <summary>
        <ToolHead tool={tool} />
      </summary>
      {body}
    </details>
  );
}

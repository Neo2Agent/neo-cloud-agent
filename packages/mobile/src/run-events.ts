import { parseContextUsage } from "@neo-cloud-agent/contracts/context-usage";
import type { RunEvent } from "@neo-cloud-agent/contracts/events";
import type { Run } from "@neo-cloud-agent/contracts/run";

export function applyRunSideEvent(run: Run, event: RunEvent): Run {
  if (event.kind === "context.usage") {
    const parsed = parseContextUsage(event.data);
    return parsed ? { ...run, contextUsage: parsed } : run;
  }
  if (event.kind === "llm.usage") {
    const promptTokens = Number(event.data?.promptTokens ?? 0);
    const completionTokens = Number(event.data?.completionTokens ?? 0);
    const totalTokens = Number(event.data?.totalTokens ?? promptTokens + completionTokens);
    const prev = run.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    return {
      ...run,
      usage: {
        promptTokens: prev.promptTokens + promptTokens,
        completionTokens: prev.completionTokens + completionTokens,
        totalTokens: prev.totalTokens + totalTokens,
      },
    };
  }
  return run;
}

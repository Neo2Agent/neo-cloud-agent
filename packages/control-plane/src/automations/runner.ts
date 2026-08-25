import { nextAutomationRunAt } from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";
import { createRun, getRun } from "../orchestrator/orchestrator.js";
import { readNotifySecrets } from "../notify/settings.js";
import { dueAutomations, getAutomation, updateAutomation } from "./store.js";

export class AutomationRunError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fireDueAutomations(at = new Date()): Promise<string[]> {
  const started: string[] = [];
  const config = getConfig();
  for (const item of dueAutomations(at)) {
    if (item.lastRunId) {
      const previous = getRun(item.lastRunId);
      if (previous && (previous.status === "RUNNING" || previous.status === "PROVISIONING" || previous.status === "INSTALLING")) {
        updateAutomation(item.id, { nextRunAt: nextAutomationRunAt(item.schedule, at).toISOString() });
        continue;
      }
    }
    try {
      const repoUrls = item.repoUrls.length > 0 ? item.repoUrls : defaultRepos();
      const run = await createRun(
        {
          prompt: item.prompt,
          repoUrls,
          source: "automation",
        },
        {
          userId: item.userId || config.userId,
          orgId: item.orgId || config.orgId,
        },
      );
      updateAutomation(item.id, {
        lastRunAt: at.toISOString(),
        lastRunId: run.id,
        lastError: null,
        nextRunAt: nextAutomationRunAt(item.schedule, at).toISOString(),
      });
      started.push(run.id);
    } catch (error) {
      updateAutomation(item.id, {
        lastError: error instanceof Error ? error.message : "automation_failed",
        nextRunAt: nextAutomationRunAt(item.schedule, at).toISOString(),
      });
    }
  }
  return started;
}

export async function runAutomationNow(
  id: string,
  actor: { userId: string; orgId: string },
  at = new Date(),
) {
  const item = getAutomation(id);
  if (!item) {
    throw new AutomationRunError(404, "自动化不存在");
  }
  if (item.userId && item.userId !== actor.userId) {
    throw new AutomationRunError(403, "只能运行自己的自动化");
  }
  if (item.lastRunId) {
    const previous = getRun(item.lastRunId);
    if (previous && (previous.status === "RUNNING" || previous.status === "PROVISIONING" || previous.status === "INSTALLING")) {
      throw new AutomationRunError(409, "上一轮还在跑，稍后再触发");
    }
  }
  const repoUrls = item.repoUrls.length > 0 ? item.repoUrls : defaultRepos();
  const run = await createRun(
    {
      prompt: item.prompt,
      repoUrls,
      source: "automation",
    },
    {
      userId: actor.userId,
      orgId: actor.orgId || item.orgId,
    },
  );
  updateAutomation(item.id, {
    lastRunAt: at.toISOString(),
    lastRunId: run.id,
    lastError: null,
    nextRunAt: item.nextRunAt,
  });
  return run;
}

function defaultRepos(): string[] {
  const repo = readNotifySecrets().defaultRepo;
  return repo ? [repo] : [];
}

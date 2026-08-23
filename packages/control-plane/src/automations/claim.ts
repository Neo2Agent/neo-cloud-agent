import { DEFAULT_ADMIN_LOGIN } from "../accounts/accounts.js";
import { getAccountStore } from "../accounts/store.js";
import { getConfig } from "../config.js";
import { adoptRun, getRun, listRuns, loadRunIntoMemory } from "../orchestrator/orchestrator.js";
import { listAutomations, updateAutomation } from "./store.js";

/** Old automations ran as the system user, so the login account never saw the chat. */
export async function claimOrphanAutomations(): Promise<void> {
  const admin = await getAccountStore().findUserByEmail(DEFAULT_ADMIN_LOGIN);
  if (!admin) {
    return;
  }
  const systemUser = getConfig().userId;
  for (const item of listAutomations()) {
    if (!item.userId) {
      updateAutomation(item.id, { userId: admin.id, orgId: item.orgId || admin.orgId });
    }
  }
  for (const item of listAutomations()) {
    const owner = item.userId || admin.id;
    const orgId = item.orgId || admin.orgId;
    if (item.lastRunId) {
      const run = getRun(item.lastRunId) ?? (await loadRunIntoMemory(item.lastRunId));
      if (run && (run.userId === systemUser || !run.userId)) {
        adoptRun(run.id, owner, orgId);
      }
    }
  }
  for (const run of listRuns()) {
    if (run.source === "automation" && (run.userId === systemUser || !run.userId)) {
      const item = listAutomations().find((row) => row.lastRunId === run.id);
      adoptRun(run.id, item?.userId || admin.id, item?.orgId || admin.orgId);
    }
  }
}

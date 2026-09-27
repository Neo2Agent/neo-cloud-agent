import { groupSidebarRuns, splitShelvedRuns, type SidebarFolder } from "@neo-cloud-agent/contracts/sidebar-runs";
import type { Run } from "@neo-cloud-agent/contracts/run";

export type MobileSidebarGroups = {
  folders: SidebarFolder<Run>[];
  repos: SidebarFolder<Run>[];
  chat: Run[];
  shelved: Run[];
};

export function mobileSidebarGroups(runs: Run[], projectNames: Record<string, string>): MobileSidebarGroups {
  const { live, shelved } = splitShelvedRuns(runs);
  const grouped = groupSidebarRuns(live, [], projectNames);
  return {
    folders: grouped.folders,
    repos: grouped.repos,
    chat: [...grouped.chat.active, ...grouped.chat.recent],
    shelved,
  };
}

export function projectNameMap(projects: Array<{ id: string; name: string }>): Record<string, string> {
  return Object.fromEntries(projects.map((item) => [item.id, item.name]));
}

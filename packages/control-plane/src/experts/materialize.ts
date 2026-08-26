import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  bundledExpertById,
  bundledTeamById,
  renderExpertRole,
  renderMemberAgentMarkdown,
  renderTeamLeadRole,
  type DeskAssignment,
  type Expert,
  type ExpertTeam,
  type ExpertWorkspaceMeta,
} from "@neo-cloud-agent/contracts";
import { resolveExpert } from "./store.js";

export type ExpertFiles = {
  expertMarkdown?: string;
  expertTeamMarkdown?: string;
  expertMeta: string;
  expertAgents: Array<{ slug: string; markdown: string }>;
};

export function buildExpertFiles(input: { expert?: Expert | null; team?: ExpertTeam | null }): ExpertFiles | null {
  if (input.team) {
    const members = input.team.memberSlugs.map((slug) => resolveExpert(slug) ?? bundledExpertById(slug)).filter(Boolean) as Expert[];
    const meta: ExpertWorkspaceMeta = {
      id: input.team.id,
      slug: input.team.slug,
      name: input.team.name,
      kind: "team",
      tools: input.team.tools,
      memberSlugs: input.team.memberSlugs,
    };
    return {
      expertTeamMarkdown: renderTeamLeadRole(input.team, members),
      expertMeta: `${JSON.stringify(meta, null, 2)}\n`,
      expertAgents: members.map((item) => ({ slug: item.slug, markdown: renderMemberAgentMarkdown(item) })),
    };
  }
  if (input.expert) {
    const meta: ExpertWorkspaceMeta = {
      id: input.expert.id,
      slug: input.expert.slug,
      name: input.expert.name,
      kind: "expert",
      tools: input.expert.tools,
      skillNames: input.expert.skillNames,
    };
    return {
      expertMarkdown: renderExpertRole(input.expert),
      expertMeta: `${JSON.stringify(meta, null, 2)}\n`,
      expertAgents: [],
    };
  }
  return null;
}

export function writeExpertFiles(workspaceDir: string, files: ExpertFiles): void {
  const dest = path.join(workspaceDir, ".neo");
  mkdirSync(dest, { recursive: true });
  writeFileSync(path.join(dest, "expert.json"), files.expertMeta);
  if (files.expertMarkdown) {
    writeFileSync(path.join(dest, "EXPERT.md"), files.expertMarkdown);
  }
  if (files.expertTeamMarkdown) {
    writeFileSync(path.join(dest, "EXPERT_TEAM.md"), files.expertTeamMarkdown);
  }
  if (files.expertAgents.length > 0) {
    const agentsDir = path.join(dest, "agents");
    mkdirSync(agentsDir, { recursive: true });
    for (const agent of files.expertAgents) {
      writeFileSync(path.join(agentsDir, `${agent.slug}.md`), agent.markdown);
    }
  }
}

export function assignmentExpertFields(files: ExpertFiles | null): Pick<
  DeskAssignment,
  "expertMarkdown" | "expertTeamMarkdown" | "expertMeta" | "expertAgents"
> {
  if (!files) return {};
  return {
    expertMarkdown: files.expertMarkdown,
    expertTeamMarkdown: files.expertTeamMarkdown,
    expertMeta: files.expertMeta,
    expertAgents: files.expertAgents,
  };
}

export function resolveTeam(id: string): ExpertTeam | null {
  return bundledTeamById(id);
}

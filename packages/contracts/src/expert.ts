export type ExpertVisibility = "bundled" | "user" | "project";

export type Expert = {
  id: string;
  slug: string;
  name: string;
  title?: string;
  description: string;
  industry?: string;
  persona: string;
  methodology: string;
  deliverables: string;
  tools?: string[];
  skillNames?: string[];
  model?: string;
  examplePrompts?: string[];
  visibility: ExpertVisibility;
  ownerUserId?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ExpertTeamWorkflow = {
  id: string;
  name: string;
  when: string;
  mode: "parallel" | "chain";
  steps: Array<{ agent: string; task: string }>;
};

export type ExpertTeam = {
  id: string;
  slug: string;
  name: string;
  description: string;
  lead: { name: string; persona: string; methodology: string };
  memberSlugs: string[];
  workflows?: ExpertTeamWorkflow[];
  tools?: string[];
  visibility: ExpertVisibility;
  ownerUserId?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateExpertRequest = {
  name: string;
  slug?: string;
  title?: string;
  description: string;
  industry?: string;
  persona: string;
  methodology: string;
  deliverables: string;
  tools?: string[];
  skillNames?: string[];
  model?: string;
  examplePrompts?: string[];
  visibility?: "user" | "project";
  projectId?: string;
};

export type UpdateExpertRequest = {
  name?: string;
  slug?: string;
  title?: string;
  description?: string;
  industry?: string;
  persona?: string;
  methodology?: string;
  deliverables?: string;
  tools?: string[] | null;
  skillNames?: string[] | null;
  model?: string | null;
  examplePrompts?: string[] | null;
};

export type ExpertWorkspaceMeta = {
  id: string;
  slug: string;
  name: string;
  kind: "expert" | "team";
  tools?: string[];
  skillNames?: string[];
  memberSlugs?: string[];
};

export const READ_ONLY_EXPERT_TOOLS = ["read", "grep", "find", "ls"] as const;
export const READ_BASH_EXPERT_TOOLS = ["read", "grep", "find", "ls", "bash"] as const;
export const EXPLORE_EXPERT_TOOLS = ["read", "grep", "find", "ls", "neo_browse"] as const;
export const TEAM_LEAD_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls", "neo_subagent"] as const;

export const MAX_EXPERT_BODY = 8_000;
export const MAX_USER_EXPERTS = 40;

const BUNDLED_AT = "2026-08-26T00:00:00.000Z";

export const BUNDLED_EXPERT_POLICY_ID = "bundled";

export const ADMIN_EXPERT_TOOL_CHOICES = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "write",
  "edit",
  "neo_browse",
  "neo_subagent",
] as const;

export type BundledExpertAudience = "all" | "allowlist";

export type BundledExpertOverrideFields = {
  name?: string;
  title?: string | null;
  description?: string;
  industry?: string | null;
  persona?: string;
  methodology?: string;
  deliverables?: string;
  tools?: string[] | null;
  skillNames?: string[] | null;
  model?: string | null;
  examplePrompts?: string[] | null;
};

export type BundledExpertPolicyEntry = {
  enabled: boolean;
  audience: BundledExpertAudience;
  userIds: string[];
  override: BundledExpertOverrideFields;
  updatedAt: string;
  publishedAt: string | null;
};

export type BundledExpertPolicyDocument = {
  version: 1;
  updatedAt: string;
  experts: Record<string, BundledExpertPolicyEntry>;
};

export type ConfigureBundledExpertRequest = BundledExpertOverrideFields & {
  enabled?: boolean;
};

export type PublishBundledExpertRequest = {
  audience: BundledExpertAudience;
  userIds?: string[];
};

export function defaultBundledExpertPolicyEntry(): BundledExpertPolicyEntry {
  return {
    enabled: true,
    audience: "all",
    userIds: [],
    override: {},
    updatedAt: BUNDLED_AT,
    publishedAt: null,
  };
}

export function emptyBundledExpertPolicyDocument(updatedAt = BUNDLED_AT): BundledExpertPolicyDocument {
  return { version: 1, updatedAt, experts: {} };
}

export function canAccessBundledExpertPolicy(
  entry: Pick<BundledExpertPolicyEntry, "enabled" | "audience" | "userIds">,
  userId?: string,
): boolean {
  if (!entry.enabled) return false;
  if (!userId || entry.audience === "all") return true;
  return entry.userIds.includes(userId);
}

export function applyBundledExpertOverride(base: Expert, override?: BundledExpertOverrideFields | null): Expert {
  if (!override) return { ...base };
  const name = override.name !== undefined ? override.name.trim() : base.name;
  const description = override.description !== undefined ? override.description.trim() : base.description;
  const persona = override.persona !== undefined ? override.persona : base.persona;
  const methodology = override.methodology !== undefined ? override.methodology : base.methodology;
  const deliverables = override.deliverables !== undefined ? override.deliverables : base.deliverables;
  return {
    ...base,
    name: name || base.name,
    title: override.title === null ? undefined : override.title !== undefined ? override.title.trim() || undefined : base.title,
    description: description || base.description,
    industry:
      override.industry === null ? undefined : override.industry !== undefined ? override.industry.trim() || undefined : base.industry,
    persona: persona.trim() ? persona : base.persona,
    methodology: methodology.trim() ? methodology : base.methodology,
    deliverables: deliverables.trim() ? deliverables : base.deliverables,
    tools: override.tools === null ? undefined : override.tools !== undefined ? override.tools.map((item) => item.trim()).filter(Boolean) : base.tools,
    skillNames:
      override.skillNames === null
        ? undefined
        : override.skillNames !== undefined
          ? override.skillNames.map((item) => item.trim()).filter(Boolean)
          : base.skillNames,
    model: override.model === null ? undefined : override.model !== undefined ? override.model.trim() || undefined : base.model,
    examplePrompts:
      override.examplePrompts === null
        ? undefined
        : override.examplePrompts !== undefined
          ? override.examplePrompts.map((item) => item.trim()).filter(Boolean)
          : base.examplePrompts,
  };
}

function bundledExpert(partial: Omit<Expert, "visibility" | "createdAt" | "updatedAt">): Expert {
  return { ...partial, visibility: "bundled", createdAt: BUNDLED_AT, updatedAt: BUNDLED_AT };
}

export const BUNDLED_EXPERTS: Expert[] = [
  bundledExpert({
    id: "exp_explorer",
    slug: "explorer",
    name: "侦察",
    title: "仓库与公开页侦察",
    description: "只读探路，压缩上下文给后续角色用",
    industry: "engineering",
    persona: `You are the explorer expert. Investigate the workspace or a public page and return structured findings another agent can use without re-reading everything.`,
    methodology: `Thoroughness (infer from the task, default medium):
- Quick: targeted lookups, key files or 1-2 pages
- Medium: follow imports, read critical sections, or a few high-signal pages
- Thorough: trace dependencies, check tests, or a short set of sources

Strategy:
1. Workspace: grep/find/ls, then read key sections — not entire files
2. Public web: use neo_browse only. Never curl, wget, or other HTTP via a shell
3. Fetch a few high-signal pages, then stop. Do not loop`,
    deliverables: `## Files Retrieved
1. \`path/file.ts\` (lines 10-50) - what is here

## Sources
- title — url — one-line takeaway

## Key Code
Short excerpts only.

## Architecture
How the pieces connect.

## Start Here
Which file or source to open first and why.`,
    tools: [...EXPLORE_EXPERT_TOOLS],
    examplePrompts: ["摸清这个仓库的登录和鉴权是怎么串起来的。", "打开这个公开页，只摘和鉴权相关的结论。"],
  }),
  bundledExpert({
    id: "exp_planner",
    slug: "planner",
    name: "规划",
    title: "只读实现计划",
    description: "根据现场和需求写出可执行步骤，不改文件",
    industry: "engineering",
    persona: `You are the planner expert. You receive findings and requirements, then produce a concrete implementation plan.`,
    methodology: `Do not modify files. Only read, analyze, and plan.
Break work into small, ordered steps with file paths.
Call out risks the implementer must watch for.`,
    deliverables: `## Goal
One sentence.

## Plan
Numbered, small, actionable steps with file paths.

## Files to Modify
- \`path/file.ts\` - what changes

## New Files (if any)

## Risks
Anything the worker must watch for.`,
    tools: [...READ_ONLY_EXPERT_TOOLS],
    examplePrompts: ["根据当前仓库，写一份给登录加上限流的实现计划。"],
  }),
  bundledExpert({
    id: "exp_reviewer",
    slug: "reviewer",
    name: "审查",
    title: "质量与正确性审查",
    description: "只读审查质量、正确性和安全，给出分级意见",
    industry: "engineering",
    persona: `You are the reviewer expert. Analyze quality, correctness, and security. You do not implement features.`,
    methodology: `Bash is read-only only: git diff, git log, git show. Do not modify files or run builds.
Be specific with paths and line numbers.
Separate must-fix from should-fix from suggestions.`,
    deliverables: `## Files Reviewed
## Critical (must fix)
## Warnings (should fix)
## Suggestions
## Summary`,
    tools: [...READ_BASH_EXPERT_TOOLS],
    examplePrompts: ["审查这次改动的正确性和安全问题，按严重程度分级。"],
  }),
  bundledExpert({
    id: "exp_implementer",
    slug: "implementer",
    name: "实现",
    title: "编码交付",
    description: "按计划改代码、跑测试、列出改动",
    industry: "engineering",
    persona: `You are the implementer expert. Complete the assigned coding task in this workspace.`,
    methodology: `Follow the plan if one exists. Run the project's tests after changes.
Do not git commit, git push, or open pull requests with bash. Use neo_git_commit and neo_pr_open when asked.
Do not invent extra scope.`,
    deliverables: `## Completed
## Files Changed
## Tests
## Notes
If handing off to a reviewer, include exact paths and key symbols.`,
    examplePrompts: ["按现有测试补上缺失的校验，改完跑测试。"],
  }),
  bundledExpert({
    id: "exp_security",
    slug: "security",
    name: "安全",
    title: "安全审查",
    description: "只做威胁模型、密钥、注入和依赖风险，不改业务功能",
    industry: "engineering",
    persona: `You are the security expert. Hunt for auth gaps, secret leaks, injection, and unsafe dependencies. You do not implement product features.`,
    methodology: `Start from trust boundaries: auth, input, secrets, outbound calls, and dependency risk.
Bash is read-only: git diff, git log, git grep. Do not modify files.
If you cannot confirm a finding, mark it as a question, not a fact.`,
    deliverables: `## Scope
## Critical
## Warnings
## Questions
## Residual risk`,
    tools: [...READ_BASH_EXPERT_TOOLS],
    examplePrompts: ["只看安全和密钥，不要改业务代码。"],
  }),
];

export const BUNDLED_EXPERT_TEAMS: ExpertTeam[] = [
  {
    id: "team_ship_change",
    slug: "ship-change",
    name: "交付改动",
    description: "规划 → 实现 → 审查，串行收口",
    lead: {
      name: "交付团长",
      persona: "You are the lead of the ship-change expert team. You coordinate, you do not write the members' professional output.",
      methodology: `Preflight against member descriptions. If the task does not match, tell the user and do not dispatch.
Use only neo_subagent. Prefer the ship-change chain when the user wants a code change shipped.
Members do not talk to each other. Summarize conflicts instead of silently rewriting them.`,
    },
    memberSlugs: ["planner", "implementer", "reviewer"],
    workflows: [
      {
        id: "ship",
        name: "交付一条改动",
        when: "用户要改代码并验收",
        mode: "chain",
        steps: [
          { agent: "planner", task: "Plan this change. {previous}" },
          { agent: "implementer", task: "Implement the plan.\n\n{previous}" },
          { agent: "reviewer", task: "Review the implementation.\n\n{previous}" },
        ],
      },
    ],
    tools: [...TEAM_LEAD_TOOLS],
    visibility: "bundled",
    createdAt: BUNDLED_AT,
    updatedAt: BUNDLED_AT,
  },
  {
    id: "team_investigate",
    slug: "investigate",
    name: "调查收口",
    description: "侦察并行探路，规划汇总",
    lead: {
      name: "调查团长",
      persona: "You are the lead of the investigate expert team. You dispatch scouting and collect a plan. You do not implement.",
      methodology: `Preflight first. Use neo_subagent only.
For a broad unknown, send explorer in parallel on distinct areas, then planner to synthesize.
Do not invent a third collaboration style when the investigate workflow matches.`,
    },
    memberSlugs: ["explorer", "planner"],
    workflows: [
      {
        id: "recon",
        name: "探路后出计划",
        when: "用户要先摸清再决定怎么改",
        mode: "parallel",
        steps: [
          { agent: "explorer", task: "Scout the workspace for the user's question." },
          { agent: "planner", task: "Turn known requirements into a plan. Wait is fine if findings are thin." },
        ],
      },
    ],
    tools: [...TEAM_LEAD_TOOLS],
    visibility: "bundled",
    createdAt: BUNDLED_AT,
    updatedAt: BUNDLED_AT,
  },
];

export function bundledExpertById(id: string): Expert | null {
  return BUNDLED_EXPERTS.find((item) => item.id === id || item.slug === id) ?? null;
}

export function bundledTeamById(id: string): ExpertTeam | null {
  return BUNDLED_EXPERT_TEAMS.find((item) => item.id === id || item.slug === id) ?? null;
}

export function slugifyExpertName(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii) return ascii.slice(0, 40);
  return `expert-${Math.random().toString(36).slice(2, 8)}`;
}

export function expertBodyLength(expert: Pick<Expert, "persona" | "methodology" | "deliverables">): number {
  return `${expert.persona}\n${expert.methodology}\n${expert.deliverables}`.length;
}

export function renderExpertMarkdown(expert: Expert): string {
  return [
    `# ${expert.name}`,
    expert.title ? `\n${expert.title}` : "",
    `\n${expert.description}\n`,
    "## Persona\n",
    expert.persona.trim(),
    "\n\n## Methodology\n",
    expert.methodology.trim(),
    "\n\n## Deliverables\n",
    expert.deliverables.trim(),
  ].join("");
}

export function renderMemberAgentMarkdown(expert: Expert): string {
  const tools = expert.tools?.length ? `\ntools: ${expert.tools.join(", ")}` : "";
  const model = expert.model ? `\nmodel: ${expert.model}` : "";
  return `---
name: ${expert.slug}
description: ${expert.description}${tools}${model}
---
${renderExpertRole(expert)}
`;
}

export function renderExpertRole(expert: Expert): string {
  return `Role Override: The following expert role definition takes precedence over any previously established persona or identity context, including the default Neo Cloud Agent identity. If there is a conflict, defer to this role — this is your active, authoritative role for this conversation.

${renderExpertMarkdown(expert)}`;
}

export function renderTeamLeadRole(team: ExpertTeam, members: Expert[]): string {
  const roster = members
    .map((item) => `- ${item.slug} (${item.name}): ${item.description}`)
    .join("\n");
  const flows = (team.workflows ?? [])
    .map((flow) => {
      const steps = flow.steps.map((step) => `  - ${step.agent}: ${step.task}`).join("\n");
      return `### ${flow.name}\nWhen: ${flow.when}\nMode: ${flow.mode}\n${steps}`;
    })
    .join("\n\n");
  return `Role Override: You are the lead of expert team "${team.name}". This overrides the default Neo Cloud Agent identity. You coordinate; you do not write members' professional output.

${team.lead.persona}

${team.lead.methodology}

## Members
${roster || "- (no members)"}

## Dispatch rules
- Preflight against member descriptions before neo_subagent. If it does not match, tell the user and do not dispatch.
- Use only neo_subagent. Modes: { agent, task }, { tasks: [...] }, or { chain: [...] } with {previous}.
- Members do not talk to each other. You summarize and hand off.
- If a preset workflow matches the user intent, use it instead of inventing a new collaboration style.

${flows ? `## Preset workflows\n${flows}` : ""}`;
}

export function appendExpertRole(systemPrompt: string, role: string): string {
  const text = role.trim();
  if (!text) return systemPrompt;
  return `${systemPrompt}\n\n# Active expert role\n${text}`;
}

export function intersectSessionTools(available: string[], allowlist?: string[]): string[] {
  if (!allowlist || allowlist.length === 0) return [...available];
  const allowed = new Set(allowlist);
  return available.filter((name) => allowed.has(name));
}

export function parseExpertWorkspaceMeta(raw: string): ExpertWorkspaceMeta | null {
  try {
    const parsed = JSON.parse(raw) as ExpertWorkspaceMeta;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string" || typeof parsed.slug !== "string" || typeof parsed.name !== "string") {
      return null;
    }
    if (parsed.kind !== "expert" && parsed.kind !== "team") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sortExpertsForPicker(items: Expert[], pinnedIds: string[] = []): Expert[] {
  const pin = new Set(pinnedIds);
  return [...items].sort((left, right) => {
    const leftPin = pin.has(left.id) ? 0 : 1;
    const rightPin = pin.has(right.id) ? 0 : 1;
    if (leftPin !== rightPin) return leftPin - rightPin;
    const vis = visibilityRank(left.visibility) - visibilityRank(right.visibility);
    if (vis !== 0) return vis;
    return left.name.localeCompare(right.name, "zh");
  });
}

function visibilityRank(value: ExpertVisibility): number {
  if (value === "project") return 0;
  if (value === "user") return 1;
  return 2;
}

export function canEditExpert(expert: Expert, actor: { userId: string; manageProject?: boolean }): boolean {
  if (expert.visibility === "bundled") return false;
  if (expert.visibility === "user") return expert.ownerUserId === actor.userId;
  return Boolean(actor.manageProject);
}

export function canUseExpert(
  expert: Expert,
  actor: { userId?: string; projectId?: string | null; projectMember?: boolean },
): boolean {
  if (expert.visibility === "bundled") return true;
  if (expert.visibility === "user") return Boolean(actor.userId && expert.ownerUserId === actor.userId);
  return Boolean(expert.projectId && actor.projectId === expert.projectId && actor.projectMember);
}

export function expertPickerLabel(expert: Expert): string {
  return expert.title ? `${expert.name} · ${expert.title}` : expert.name;
}

export type ExpertPick = {
  expertId?: string;
  expertTeamId?: string;
};

export function encodeExpertPick(pick: ExpertPick): string {
  if (pick.expertTeamId) return `team:${pick.expertTeamId}`;
  if (pick.expertId) return `expert:${pick.expertId}`;
  return "";
}

export function decodeExpertPick(value: string): ExpertPick {
  const raw = value.trim();
  if (!raw || raw === "neo") return {};
  if (raw.startsWith("team:")) return { expertTeamId: raw.slice(5) };
  if (raw.startsWith("expert:")) return { expertId: raw.slice(7) };
  return { expertId: raw };
}

export function expertVisibilityLabel(visibility: ExpertVisibility): string {
  if (visibility === "bundled") return "内置";
  if (visibility === "project") return "项目";
  return "我的";
}

export type Recipe = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  expertId?: string;
  expertTeamId?: string;
  pluginIds?: string[];
};

export type ProjectTemplate = {
  id: string;
  name: string;
  instruction: string;
  expertIds: string[];
  pluginIds: string[];
};

export type IntentCapsule = {
  id: string;
  label: string;
  keywords: string[];
  expertId?: string;
  expertTeamId?: string;
  pluginIds?: string[];
};

export const BUNDLED_RECIPES: Recipe[] = [
  {
    id: "recipe_fix_ci",
    title: "修 CI 红",
    description: "看失败日志，改到测试绿。",
    prompt: "CI 红了。先看失败日志和最近改动，最小改动修到测试通过。不要扩大范围，不要用 bash 做 git commit / push。",
    expertId: "exp_implementer",
  },
  {
    id: "recipe_rfc",
    title: "写 RFC",
    description: "只读仓库，写出可执行方案。",
    prompt: "根据当前仓库写一份 RFC：背景、方案、步骤、要改的文件、风险。不要改文件。",
    expertId: "exp_planner",
  },
  {
    id: "recipe_review_pr",
    title: "审查 PR",
    description: "按严重级出意见，不改业务代码。",
    prompt: "审查这次改动的正确性和安全问题，按 Blockers / Risks / Notes 列出。不要改业务代码。",
    expertId: "exp_reviewer",
    pluginIds: ["plug_pr_review"],
  },
  {
    id: "recipe_tests_pr",
    title: "补测再开 draft PR",
    description: "补测试，再走受控提交和草稿 PR。",
    prompt: "按现有测试补上缺失的校验，改完跑测试。通过后用 neo_git_commit 和 neo_pr_open 开草稿 PR。",
    expertId: "exp_implementer",
  },
  {
    id: "recipe_ship",
    title: "交付一条改动",
    description: "规划 → 实现 → 审查。",
    prompt: "按项目现状交付这一条改动：先计划，再实现，最后审查。不要用 bash 做 git push。",
    expertTeamId: "team_ship_change",
  },
  {
    id: "recipe_scout",
    title: "摸清仓库",
    description: "先摸目录和入口，再下结论。",
    prompt: "先摸清这个仓库的布局、怎么跑、入口在哪。不要改文件。",
    expertId: "exp_explorer",
    pluginIds: ["plug_repo_scout"],
  },
  {
    id: "recipe_incident",
    title: "事故简报",
    description: "根据日志写一页简报，不编造根因。",
    prompt: "根据现有日志和近期提交写一页事故简报。不知道的标成未知，不要编造根因。",
    expertId: "exp_explorer",
    pluginIds: ["plug_incident_brief"],
  },
  {
    id: "recipe_security",
    title: "安全审查",
    description: "只看威胁模型和密钥，不改功能。",
    prompt: "只看安全和密钥：鉴权、注入、出站、依赖风险。不要改业务代码。",
    expertId: "exp_security",
  },
  {
    id: "recipe_release",
    title: "写发布说明",
    description: "从提交写成用户能看的发版说明。",
    prompt: "根据最近提交写一版用户能看的发布说明。",
    pluginIds: ["plug_release_notes"],
  },
  {
    id: "recipe_investigate",
    title: "调查未知问题",
    description: "侦察并行探路，再收成计划。",
    prompt: "这是一个未知问题。先分头摸现场，再汇总成一份可执行计划。先不要改代码。",
    expertTeamId: "team_investigate",
  },
];

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "code-review",
    name: "代码审查",
    instruction:
      "这个项目里的对话默认做代码审查。先读 diff 和测试，按 Critical / Warnings / Suggestions 分级。不要改业务功能，除非用户明确要求落地修复。",
    expertIds: ["exp_reviewer"],
    pluginIds: ["plug_pr_review"],
  },
  {
    id: "ship-change",
    name: "交付改动",
    instruction:
      "这个项目里的对话默认交付一条可验收改动。按计划改、跑项目测试、用 neo_git_commit / neo_pr_open 开草稿 PR。不要用 bash 做 git push。",
    expertIds: ["exp_planner", "exp_implementer", "exp_reviewer"],
    pluginIds: [],
  },
  {
    id: "incident",
    name: "事故处理",
    instruction:
      "这个项目里的对话默认处理线上事故。先收集时间线、影响面和证据，再给下一步。不知道的标成未知，不要编造根因。",
    expertIds: ["exp_explorer"],
    pluginIds: ["plug_incident_brief"],
  },
];

export const INTENT_CAPSULES: IntentCapsule[] = [
  {
    id: "intent_ship",
    label: "像是要交付改动 → 交付团",
    keywords: ["开 pr", "开pr", "draft pr", "交付", "改代码", "实现", "修 bug", "修bug"],
    expertTeamId: "team_ship_change",
  },
  {
    id: "intent_review",
    label: "像是要审查 → 审查专家",
    keywords: ["审查", "review", "code review", "看 diff", "看diff"],
    expertId: "exp_reviewer",
    pluginIds: ["plug_pr_review"],
  },
  {
    id: "intent_incident",
    label: "像是查事故 → 事故简报",
    keywords: ["日志", "事故", "报错", "报警", "oncall", "incident"],
    pluginIds: ["plug_incident_brief"],
  },
  {
    id: "intent_scout",
    label: "像是摸仓库 → 侦察",
    keywords: ["摸清", "仓库", "布局", "怎么跑", "入口"],
    expertId: "exp_explorer",
    pluginIds: ["plug_repo_scout"],
  },
  {
    id: "intent_security",
    label: "像是看安全 → 安全专家",
    keywords: ["安全", "密钥", "注入", "xss", "鉴权"],
    expertId: "exp_security",
  },
  {
    id: "intent_release",
    label: "像是写发版说明 → 发布说明",
    keywords: ["发布说明", "changelog", "发版", "release notes"],
    pluginIds: ["plug_release_notes"],
  },
  {
    id: "intent_plan",
    label: "像是要计划 → 规划专家",
    keywords: ["rfc", "计划", "方案", "怎么做"],
    expertId: "exp_planner",
  },
  {
    id: "intent_ci",
    label: "像是修测试 → 实现专家",
    keywords: ["ci", "测试红", "单测", "typecheck"],
    expertId: "exp_implementer",
  },
];

export function recipeById(id: string): Recipe | null {
  return BUNDLED_RECIPES.find((item) => item.id === id) ?? null;
}

export function projectTemplateById(id: string): ProjectTemplate | null {
  return PROJECT_TEMPLATES.find((item) => item.id === id) ?? null;
}

export function matchIntentCapsules(prompt: string, limit = 3): IntentCapsule[] {
  const text = prompt.replace(/\s+/g, " ").trim().toLowerCase();
  if (text.length < 12) return [];
  const hits = INTENT_CAPSULES.filter((item) => item.keywords.some((keyword) => text.includes(keyword.toLowerCase())));
  return hits.slice(0, limit);
}

export function formatHandoffMarkdown(input: {
  fromRunId: string;
  fromPrompt: string;
  note?: string;
  actorEmail?: string;
  messages?: Array<{ role: string; text: string }>;
  artifacts?: Array<{ name: string }>;
  pullRequests?: Array<{ url?: string | null }>;
}): string {
  const lines = [
    "# 交接",
    "",
    `- 原对话：\`${input.fromRunId}\``,
    input.actorEmail ? `- 交接人：${input.actorEmail}` : "",
    "",
    "## 原任务",
    "",
    input.fromPrompt.trim() || "（空）",
    "",
  ];
  if (input.note?.trim()) {
    lines.push("## 交接说明", "", input.note.trim(), "");
  }
  const prs = (input.pullRequests ?? []).map((item) => item.url).filter((item): item is string => Boolean(item));
  if (prs.length > 0) {
    lines.push("## PR", "", ...prs.map((url) => `- ${url}`), "");
  }
  const artifacts = input.artifacts ?? [];
  if (artifacts.length > 0) {
    lines.push("## 产物", "", ...artifacts.map((item) => `- ${item.name}`), "");
  }
  const messages = (input.messages ?? [])
    .filter((item) => item.text.trim() && (item.role === "user" || item.role === "assistant"))
    .slice(-12);
  if (messages.length > 0) {
    lines.push("## 最近对话", "");
    for (const message of messages) {
      const who = message.role === "user" ? "用户" : "Agent";
      lines.push(`### ${who}`, "", message.text.replace(/\s+/g, " ").trim().slice(0, 500), "");
    }
  }
  lines.push("接着上次的目标和仓库继续，不要让接手人重讲背景。");
  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n");
}

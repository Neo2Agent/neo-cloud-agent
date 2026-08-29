import type { BuddyIconName } from "./icons";

export type BuddySkill = {
  id: string;
  label: string;
  icon: BuddyIconName;
};

const RECIPE_META: Record<string, Pick<BuddySkill, "label" | "icon">> = {
  recipe_fix_ci: { label: "修 CI", icon: "code" },
  recipe_rfc: { label: "写 RFC", icon: "doc" },
  recipe_review_pr: { label: "审查 PR", icon: "search" },
  recipe_tests_pr: { label: "补测 PR", icon: "diff" },
  recipe_ship: { label: "工作台", icon: "grid" },
  recipe_scout: { label: "摸仓库", icon: "globe" },
  recipe_incident: { label: "事故简报", icon: "alert" },
  recipe_security: { label: "安全审查", icon: "shield" },
  recipe_release: { label: "发布说明", icon: "slides" },
  recipe_investigate: { label: "深度研究", icon: "chart" },
};

export function buddySkillsFromRecipes(recipes: Array<{ id: string; title: string }>): BuddySkill[] {
  return recipes.map((item) => ({
    id: item.id,
    label: RECIPE_META[item.id]?.label ?? item.title,
    icon: RECIPE_META[item.id]?.icon ?? "grid",
  }));
}

export const BUDDY_SHORTCUTS: Array<{ id: "experts" | "skills" | "projects" | "more"; label: string; icon: BuddyIconName }> = [
  { id: "experts", label: "专家", icon: "expert" },
  { id: "skills", label: "技能", icon: "skill" },
  { id: "projects", label: "项目", icon: "project" },
  { id: "more", label: "更多", icon: "more" },
];

export function padBuddyGrid<T>(items: T[], columns: number): Array<T | undefined> {
  const rem = items.length % columns;
  if (rem === 0 || columns < 2) return items;
  if (rem === 1) {
    return [...items.slice(0, -1), undefined, items[items.length - 1], undefined];
  }
  return [...items, ...Array.from({ length: columns - rem }, () => undefined)];
}


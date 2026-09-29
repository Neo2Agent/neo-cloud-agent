/** Same tool name and arguments, in a row. A different call resets the streak. */
export type RepeatAction = "run" | "replay" | "stop";

export type RepeatState = {
  last: string;
  streak: number;
};

export const REPEAT_NOTE = "这条命令已经跑过，不要再执行。上次结果：";
export const DUPLICATE_STOP = "同一命令重复调用，已停止";
export const RUNAWAY_STOP = "工具调用没有结束，已停止";

/** Distinct tool-using model calls before a turn that never finishes is stopped. */
export const SAFETY_TOOL_ROUNDS = 200;

export function toolSignature(name: string, args: unknown): string {
  return `${name}\n${stableJson(args)}`;
}

export function classifyRepeat(state: RepeatState, signature: string): { state: RepeatState; action: RepeatAction } {
  if (signature === state.last) {
    const streak = state.streak + 1;
    const next = { last: signature, streak };
    if (streak >= 3) return { state: next, action: "stop" };
    if (streak === 2) return { state: next, action: "replay" };
    return { state: next, action: "run" };
  }
  return { state: { last: signature, streak: 1 }, action: "run" };
}

export function isRunaway(toolRounds: number): boolean {
  return toolRounds > SAFETY_TOOL_ROUNDS;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Same tool name and arguments, in a row. A different call resets the streak. */
export type RepeatAction = "run" | "replay" | "stop";

export type RepeatState = {
  last: string;
  streak: number;
};

export const REPEAT_NOTE = "这条命令已经跑过，不要再执行。上次结果：";
export const DUPLICATE_STOP = "同一命令重复调用，已停止";
export const RUNAWAY_STOP = "工具调用没有结束，已停止";
export const SLEEP_POLL_NOTE = "不要用 sleep 等待构建或模拟器。把长任务放后台，或直接跑完再读日志。";
export const WRAP_STEER = "停止新的探索。用一段话说明做了什么、验证结果、还剩什么。不要再调用工具。";

/** Tool-using model replies before the loop asks for a written close. */
export const WRAP_TOOL_ROUNDS = 40;
/** A sleep this long is polling, not a short pause between commands. */
export const SLEEP_POLL_SECONDS = 15;
const SLEEP_POLL_SIGNATURE = "bash\nsleep-poll";

export function longestSleepSeconds(command: string): number {
  let longest = 0;
  for (const match of command.matchAll(/\bsleep\s+(\d+(?:\.\d+)?)/g)) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds > longest) {
      longest = seconds;
    }
  }
  return longest;
}

export function isSleepPoll(command: string): boolean {
  return longestSleepSeconds(command) >= SLEEP_POLL_SECONDS;
}

export function needsWrap(toolRounds: number): boolean {
  return toolRounds >= WRAP_TOOL_ROUNDS;
}

export function toolSignature(name: string, args: unknown): string {
  if (name === "bash" && isRecord(args)) {
    const command = args.command;
    if (typeof command === "string" && isSleepPoll(command)) {
      return SLEEP_POLL_SIGNATURE;
    }
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

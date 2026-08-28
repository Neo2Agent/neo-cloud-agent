import { CliError, EXIT_USAGE } from "./errors.js";

export type OutputFormat = "text" | "json" | "stream-json";
export type FollowDelivery = "prompt" | "steer" | "follow_up";

export type CommandName =
  | "login"
  | "logout"
  | "whoami"
  | "health"
  | "run"
  | "follow"
  | "resume"
  | "ls"
  | "get"
  | "log"
  | "abort"
  | "archive"
  | "diff"
  | "diag"
  | "pr"
  | "commit"
  | "env"
  | "build"
  | "vms"
  | "plugin"
  | "help";

export const COMMANDS: readonly CommandName[] = [
  "login",
  "logout",
  "whoami",
  "health",
  "run",
  "follow",
  "resume",
  "ls",
  "get",
  "log",
  "abort",
  "archive",
  "diff",
  "diag",
  "pr",
  "commit",
  "env",
  "build",
  "vms",
  "plugin",
  "help",
];

const COMMAND_SET = new Set<string>(COMMANDS);

export interface CliFlags {
  url?: string;
  apiKey?: string;
  output: OutputFormat;
  print: boolean;
  detach: boolean;
  help: boolean;
  version: boolean;
  email?: string;
  password?: string;
  token?: string;
  repos: string[];
  dirs: string[];
  envId?: string;
  buildId?: string;
  model?: string;
  expertId?: string;
  expertTeamId?: string;
  plugins: string[];
  projectId?: string;
  ref?: string;
  reuseBuild?: boolean;
  timeoutMs?: number;
  delivery?: FollowDelivery;
  title?: string;
  body?: string;
  message?: string;
  follow: boolean;
}

export interface ParsedCli {
  command: CommandName;
  args: string[];
  flags: CliFlags;
}

const DEFAULT_FLAGS: CliFlags = {
  output: "text",
  print: false,
  detach: false,
  help: false,
  version: false,
  repos: [],
  dirs: [],
  plugins: [],
  follow: false,
};

export function parseDuration(raw: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i.exec(raw.trim());
  if (!match) {
    throw new CliError(`invalid duration: ${raw}`, EXIT_USAGE);
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? "ms").toLowerCase();
  if (unit === "ms") return Math.round(value);
  if (unit === "s") return Math.round(value * 1000);
  if (unit === "m") return Math.round(value * 60_000);
  return Math.round(value * 3_600_000);
}

function takeValue(argv: string[], index: number, flag: string): { value: string; next: number } {
  const current = argv[index] ?? "";
  const eq = current.indexOf("=");
  if (eq >= 0 && current.slice(0, eq) === flag) {
    const value = current.slice(eq + 1);
    if (!value) {
      throw new CliError(`${flag} needs a value`, EXIT_USAGE);
    }
    return { value, next: index + 1 };
  }
  const next = argv[index + 1];
  if (!next || next.startsWith("-")) {
    throw new CliError(`${flag} needs a value`, EXIT_USAGE);
  }
  return { value: next, next: index + 2 };
}

function parseOutput(raw: string): OutputFormat {
  if (raw === "text" || raw === "json" || raw === "stream-json") {
    return raw;
  }
  throw new CliError(`output format must be text|json|stream-json, got ${raw}`, EXIT_USAGE);
}

function parseDelivery(raw: string): FollowDelivery {
  if (raw === "prompt" || raw === "steer" || raw === "follow_up") {
    return raw;
  }
  throw new CliError(`delivery must be prompt|steer|follow_up, got ${raw}`, EXIT_USAGE);
}

export function parseArgv(argv: string[]): ParsedCli {
  const flags: CliFlags = {
    ...DEFAULT_FLAGS,
    repos: [],
    dirs: [],
    plugins: [],
  };
  const rest: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i] ?? "";
    if (arg === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h" || arg === "--help") {
      flags.help = true;
      i += 1;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      flags.version = true;
      i += 1;
      continue;
    }
    if (arg === "-p" || arg === "--print") {
      flags.print = true;
      i += 1;
      continue;
    }
    if (arg === "--detach" || arg === "--no-wait") {
      flags.detach = true;
      i += 1;
      continue;
    }
    if (arg === "--wait") {
      flags.detach = false;
      i += 1;
      continue;
    }
    if (arg === "--follow") {
      flags.follow = true;
      i += 1;
      continue;
    }
    if (arg === "--json") {
      flags.output = "json";
      i += 1;
      continue;
    }
    if (arg === "--reuse-build") {
      flags.reuseBuild = true;
      i += 1;
      continue;
    }
    if (arg === "--no-reuse-build") {
      flags.reuseBuild = false;
      i += 1;
      continue;
    }
    if (arg === "--url" || arg.startsWith("--url=")) {
      const taken = takeValue(argv, i, "--url");
      flags.url = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--api-key" || arg.startsWith("--api-key=")) {
      const taken = takeValue(argv, i, "--api-key");
      flags.apiKey = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--output-format" || arg.startsWith("--output-format=") || arg === "--output" || arg.startsWith("--output=")) {
      const flag = arg.startsWith("--output-format") ? "--output-format" : "--output";
      const taken = takeValue(argv, i, flag);
      flags.output = parseOutput(taken.value);
      i = taken.next;
      continue;
    }
    if (arg === "--email" || arg.startsWith("--email=")) {
      const taken = takeValue(argv, i, "--email");
      flags.email = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--password" || arg.startsWith("--password=")) {
      const taken = takeValue(argv, i, "--password");
      flags.password = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--token" || arg.startsWith("--token=")) {
      const taken = takeValue(argv, i, "--token");
      flags.token = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--repo" || arg.startsWith("--repo=")) {
      const taken = takeValue(argv, i, "--repo");
      flags.repos.push(taken.value);
      i = taken.next;
      continue;
    }
    if (arg === "--dir" || arg.startsWith("--dir=")) {
      const taken = takeValue(argv, i, "--dir");
      flags.dirs.push(taken.value);
      i = taken.next;
      continue;
    }
    if (arg === "--env" || arg.startsWith("--env=")) {
      const taken = takeValue(argv, i, "--env");
      flags.envId = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--build" || arg.startsWith("--build=")) {
      const taken = takeValue(argv, i, "--build");
      flags.buildId = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--model" || arg.startsWith("--model=")) {
      const taken = takeValue(argv, i, "--model");
      flags.model = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--expert" || arg.startsWith("--expert=")) {
      const taken = takeValue(argv, i, "--expert");
      flags.expertId = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--expert-team" || arg.startsWith("--expert-team=")) {
      const taken = takeValue(argv, i, "--expert-team");
      flags.expertTeamId = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--plugin" || arg.startsWith("--plugin=")) {
      const taken = takeValue(argv, i, "--plugin");
      flags.plugins.push(taken.value);
      i = taken.next;
      continue;
    }
    if (arg === "--project" || arg.startsWith("--project=")) {
      const taken = takeValue(argv, i, "--project");
      flags.projectId = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--ref" || arg.startsWith("--ref=")) {
      const taken = takeValue(argv, i, "--ref");
      flags.ref = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--timeout" || arg.startsWith("--timeout=")) {
      const taken = takeValue(argv, i, "--timeout");
      flags.timeoutMs = parseDuration(taken.value);
      i = taken.next;
      continue;
    }
    if (arg === "--delivery" || arg.startsWith("--delivery=")) {
      const taken = takeValue(argv, i, "--delivery");
      flags.delivery = parseDelivery(taken.value);
      i = taken.next;
      continue;
    }
    if (arg === "--title" || arg.startsWith("--title=")) {
      const taken = takeValue(argv, i, "--title");
      flags.title = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "--body" || arg.startsWith("--body=")) {
      const taken = takeValue(argv, i, "--body");
      flags.body = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === "-m" || arg.startsWith("-m=") || arg === "--message" || arg.startsWith("--message=")) {
      const flag = arg.startsWith("-m") ? "-m" : "--message";
      const taken = takeValue(argv, i, flag);
      flags.message = taken.value;
      i = taken.next;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliError(`unknown flag: ${arg}`, EXIT_USAGE);
    }
    rest.push(arg);
    i += 1;
  }

  const first = rest[0];
  if (first && COMMAND_SET.has(first)) {
    return { command: first as CommandName, args: rest.slice(1), flags };
  }
  if (flags.help && rest.length === 0) {
    return { command: "help", args: [], flags };
  }
  if (flags.version && rest.length === 0) {
    return { command: "help", args: [], flags };
  }
  if (rest.length === 0 && !flags.help && !flags.version) {
    return { command: "help", args: [], flags };
  }
  return { command: "run", args: rest, flags };
}

export function promptFromArgs(args: string[]): string {
  return args.join(" ").trim();
}

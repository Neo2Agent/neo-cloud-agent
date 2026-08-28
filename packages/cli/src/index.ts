#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";
import {
  abortCommand,
  archiveCommand,
  buildCommand,
  commitCommand,
  diagCommand,
  diffCommand,
  envCommand,
  followCommand,
  getCommand,
  healthCommand,
  logCommand,
  loginCommand,
  logoutCommand,
  lsCommand,
  pluginCommand,
  prCommand,
  resumeCommand,
  runCommand,
  vmsCommand,
  whoamiCommand,
} from "./commands.js";
import { isCliError, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "./errors.js";
import { CLI_VERSION, HELP_TEXT, commandHelp } from "./help.js";
import { defaultIo, writeLine, type CliIo } from "./io.js";
import { parseArgv } from "./parse.js";

export async function dispatch(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  const parsed = parseArgv(argv);
  if (parsed.flags.version && parsed.command === "help" && parsed.args.length === 0) {
    writeLine(io.out, CLI_VERSION);
    return EXIT_OK;
  }
  if (parsed.flags.help || parsed.command === "help") {
    writeLine(io.out, parsed.args[0] ? commandHelp(parsed.args[0]) : HELP_TEXT);
    return EXIT_OK;
  }
  switch (parsed.command) {
    case "login":
      return loginCommand(parsed, io);
    case "logout":
      return logoutCommand(parsed, io);
    case "whoami":
      return whoamiCommand(parsed, io);
    case "health":
      return healthCommand(parsed, io);
    case "run":
      return runCommand(parsed, io);
    case "follow":
      return followCommand(parsed, io);
    case "resume":
      return resumeCommand(parsed, io);
    case "ls":
      return lsCommand(parsed, io);
    case "get":
      return getCommand(parsed, io);
    case "log":
      return logCommand(parsed, io);
    case "abort":
      return abortCommand(parsed, io);
    case "archive":
      return archiveCommand(parsed, io);
    case "diff":
      return diffCommand(parsed, io);
    case "diag":
      return diagCommand(parsed, io);
    case "pr":
      return prCommand(parsed, io);
    case "commit":
      return commitCommand(parsed, io);
    case "env":
      return envCommand(parsed, io);
    case "build":
      return buildCommand(parsed, io);
    case "vms":
      return vmsCommand(parsed, io);
    case "plugin":
      return pluginCommand(parsed, io);
    default:
      writeLine(io.err, HELP_TEXT);
      return EXIT_USAGE;
  }
}

export async function main(argv: string[], io?: CliIo): Promise<number> {
  const actual = io ?? defaultIo();
  try {
    return await dispatch(argv, actual);
  } catch (error) {
    if (isCliError(error)) {
      writeLine(actual.err, error.message);
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : "cli_error";
    writeLine(actual.err, message);
    return EXIT_ERROR;
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  process.exitCode = await main(process.argv.slice(2));
}

import { TOOLS_CHANNEL_VERSION, type ToolsChannelFrame } from "@neo-cloud-agent/contracts";
import type { ToolsHub } from "./hub.js";

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "read",
      description: "Read a file relative to the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write",
      description: "Write a file relative to the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, contents: { type: "string" } },
        required: ["path", "contents"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit",
      description: "Replace one exact string in a workspace file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "bash",
      description: "Run a shell command in the workspace.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "grep",
      description: "Search file contents in the workspace.",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string" }, path: { type: "string" } },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find",
      description: "Find files by name in the workspace.",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string" }, path: { type: "string" } },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ls",
      description: "List a workspace directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: [],
      },
    },
  },
];

const OUTPUT_LIMIT = 12_000;

export function clipToolOutput(text: string): string {
  if (text.length <= OUTPUT_LIMIT) {
    return text;
  }
  return `${text.slice(0, OUTPUT_LIMIT)}\n… (${text.length - OUTPUT_LIMIT} more bytes)`;
}

export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export type ToolCaller = Pick<ToolsHub, "call">;

export async function runTool(
  hub: ToolCaller,
  runId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const pathArg = stringArg(args, "path") || ".";
  switch (name) {
    case "read":
      return clipToolOutput((await hub.call(runId, fsFrame("fs.download", pathArg))).text);
    case "write":
      return clipToolOutput(
        (await hub.call(runId, uploadFrame(pathArg, stringArg(args, "contents")))).text,
      );
    case "ls":
      return clipToolOutput((await hub.call(runId, fsFrame("fs.list", pathArg === "" ? "." : pathArg))).text);
    case "edit":
      return clipToolOutput(await editFile(hub, runId, pathArg, stringArg(args, "old_string"), stringArg(args, "new_string")));
    case "bash":
      return clipToolOutput((await hub.call(runId, execFrame(stringArg(args, "command")))).text);
    case "grep":
      return clipToolOutput(
        (
          await hub.call(
            runId,
            execFrame(`grep -n -F -e ${shQuote(stringArg(args, "pattern"))} -- ${shQuote(pathArg)}`),
          )
        ).text,
      );
    case "find":
      return clipToolOutput(
        (
          await hub.call(
            runId,
            execFrame(`find ${shQuote(pathArg)} -name ${shQuote(stringArg(args, "pattern"))}`),
          )
        ).text,
      );
    default:
      return `unknown tool ${name}`;
  }
}

async function editFile(hub: ToolCaller, runId: string, path: string, oldText: string, newText: string): Promise<string> {
  if (!oldText) {
    return "old_string is required";
  }
  const current = await hub.call(runId, fsFrame("fs.download", path));
  if (!current.ok) {
    return current.text;
  }
  const index = current.text.indexOf(oldText);
  if (index < 0) {
    return "old_string was not found";
  }
  const next = `${current.text.slice(0, index)}${newText}${current.text.slice(index + oldText.length)}`;
  const written = await hub.call(runId, uploadFrame(path, next));
  return written.ok ? `edited ${path}` : written.text;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function fsFrame(type: "fs.download" | "fs.list", path: string): ToolsChannelFrame {
  return { v: TOOLS_CHANNEL_VERSION, type, callId: crypto.randomUUID(), path };
}

function uploadFrame(path: string, contents: string): ToolsChannelFrame {
  return {
    v: TOOLS_CHANNEL_VERSION,
    type: "fs.upload",
    callId: crypto.randomUUID(),
    path,
    bytesB64: Buffer.from(contents, "utf8").toString("base64"),
  };
}

/** Omit cwd so the Desk executor uses its own sandbox root, never /workspace. */
function execFrame(command: string): ToolsChannelFrame {
  return {
    v: TOOLS_CHANNEL_VERSION,
    type: "exec",
    callId: crypto.randomUUID(),
    command,
    timeoutMs: 60_000,
  };
}

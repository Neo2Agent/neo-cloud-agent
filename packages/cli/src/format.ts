import type { Run, RunEvent } from "@neo-cloud-agent/contracts";
import { EXIT_ERROR, EXIT_OK, EXIT_TIMEOUT } from "./errors.js";
import type { CliIo } from "./io.js";
import { writeLine } from "./io.js";
import type { OutputFormat } from "./parse.js";

export const CLI_PROTOCOL = "neo.cli.v1";

export type ResultSubtype = "success" | "error" | "timeout" | "aborted" | "detached";

export interface CliResult {
  type: "result";
  subtype: ResultSubtype;
  protocol: typeof CLI_PROTOCOL;
  is_error: boolean;
  duration_ms: number;
  result: string;
  run_id: string;
  status: string;
  event_count: number;
  error?: string;
}

export function eventText(event: RunEvent): string {
  if (event.kind === "message.delta") {
    return String(event.data?.delta ?? "");
  }
  if (event.kind === "user.message") {
    return String(event.data?.text ?? event.title);
  }
  return event.detail ? `${event.title}: ${event.detail}` : event.title;
}

export function toolName(event: RunEvent): string {
  return String(event.data?.toolName ?? "tool");
}

export function accumulateAssistant(events: RunEvent[]): string {
  let text = "";
  for (const event of events) {
    if (event.kind === "message.delta") {
      text += String(event.data?.delta ?? "");
    }
  }
  return text;
}

export function mapStreamEvent(event: RunEvent): Record<string, unknown> {
  if (event.kind === "message.delta") {
    return { type: "assistant", text: String(event.data?.delta ?? ""), delta: true };
  }
  if (event.kind === "tool.start" || event.kind === "tool.update" || event.kind === "tool.end") {
    const phase = event.kind === "tool.start" ? "start" : event.kind === "tool.end" ? "end" : "update";
    return { type: "tool", phase, name: toolName(event), title: event.title };
  }
  return {
    type: "event",
    kind: event.kind,
    title: event.title,
    id: event.id,
    created_at: event.createdAt,
    ...(event.data ? { data: event.data } : {}),
  };
}

export function resultFrom(input: {
  subtype: ResultSubtype;
  run: Pick<Run, "id" | "status">;
  durationMs: number;
  result: string;
  eventCount: number;
  error?: string;
}): CliResult {
  const isError = input.subtype === "error" || input.subtype === "timeout" || input.subtype === "aborted";
  return {
    type: "result",
    subtype: input.subtype,
    protocol: CLI_PROTOCOL,
    is_error: isError,
    duration_ms: input.durationMs,
    result: input.result,
    run_id: input.run.id,
    status: input.run.status,
    event_count: input.eventCount,
    ...(input.error ? { error: input.error } : {}),
  };
}

export function exitFor(result: CliResult): number {
  if (result.subtype === "timeout") {
    return EXIT_TIMEOUT;
  }
  if (result.is_error) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

const SETUP_PREFIXES = ["scm.", "run.install", "run.start", "run.terminal", "build.", "egress."];

function isSetup(kind: string): boolean {
  return SETUP_PREFIXES.some((prefix) => kind.startsWith(prefix)) || kind.startsWith("run.");
}

export interface Formatter {
  init(run: Pick<Run, "id" | "model" | "status">): void;
  event(event: RunEvent): void;
  finish(result: CliResult): number;
}

export function createFormatter(format: OutputFormat, io: CliIo): Formatter {
  if (format === "json") {
    return {
      init() {},
      event() {},
      finish(result) {
        if (result.is_error) {
          writeLine(io.err, result.error ?? result.result ?? result.subtype);
          return exitFor(result);
        }
        writeLine(io.out, JSON.stringify(result));
        return exitFor(result);
      },
    };
  }

  if (format === "stream-json") {
    return {
      init(run) {
        writeLine(
          io.out,
          JSON.stringify({
            type: "system",
            subtype: "init",
            protocol: CLI_PROTOCOL,
            run_id: run.id,
            model: run.model,
            status: run.status,
          }),
        );
      },
      event(event) {
        writeLine(io.out, JSON.stringify(mapStreamEvent(event)));
      },
      finish(result) {
        writeLine(io.out, JSON.stringify(result));
        return exitFor(result);
      },
    };
  }

  return {
    init(run) {
      writeLine(io.err, `run ${run.id} ${run.status}`);
    },
    event(event) {
      if (event.kind === "message.delta") {
        io.out.write(String(event.data?.delta ?? ""));
        return;
      }
      if (event.kind === "message.end" || event.kind === "agent.end") {
        io.out.write("\n");
        return;
      }
      if (event.kind === "tool.start") {
        writeLine(io.out, `$ ${toolName(event)}`);
        return;
      }
      if (event.kind === "tool.end") {
        const mark = event.data?.isError === true ? "✗" : "✓";
        writeLine(io.out, `${mark} ${toolName(event)}`);
        return;
      }
      if (event.kind === "user.message") {
        writeLine(io.out, `> ${eventText(event)}`);
        return;
      }
      if (isSetup(event.kind) || event.kind === "followup.queued" || event.kind === "followup.delivered") {
        writeLine(io.err, `[${event.kind}] ${event.title}`);
      }
    },
    finish(result) {
      if (result.subtype === "detached") {
        writeLine(io.out, result.run_id);
        return exitFor(result);
      }
      if (result.result && !result.result.endsWith("\n")) {
        io.out.write("\n");
      }
      if (result.is_error) {
        writeLine(io.err, result.error ?? result.subtype);
      }
      return exitFor(result);
    },
  };
}

export function printJsonOrText(io: CliIo, format: OutputFormat, value: unknown): void {
  if (format === "text") {
    writeLine(io.out, typeof value === "string" ? value : JSON.stringify(value, null, 2));
    return;
  }
  writeLine(io.out, JSON.stringify(value));
}

/**
 * One place that decides what a Desk log line looks like.
 *
 * Desk logs land in a terminal the user never opens, so the only thing that
 * makes them useful afterwards is context: which run, which folder, which pid.
 * Every line therefore carries a scope and named fields instead of a sentence
 * built by string concatenation, and errors always print both the message and
 * the stack.
 */

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export type DeskLogger = {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  /** `error` is whatever was caught, including values that are not `Error`. */
  error(message: string, error?: unknown, fields?: LogFields): void;
};

/** Where the line came from, e.g. `desk:local-run`. */
const SCOPE_PREFIX = "desk";

/** Fields with no value are dropped rather than printed as `key=undefined`. */
export function formatFields(fields?: LogFields): string {
  if (!fields) {
    return "";
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    parts.push(`${key}=${typeof value === "string" && /\s/.test(value) ? JSON.stringify(value) : String(value)}`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/** The message and the stack, so a report has both the what and the where. */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ? `${error.message}\n${error.stack}` : error.message;
  }
  if (error === undefined) {
    return "";
  }
  return String(error);
}

export function formatLine(scope: string, message: string, fields?: LogFields): string {
  return `[${SCOPE_PREFIX}:${scope}] ${message}${formatFields(fields)}`;
}

export function deskLogger(scope: string): DeskLogger {
  return {
    info(message, fields) {
      console.log(formatLine(scope, message, fields));
    },
    warn(message, fields) {
      console.warn(formatLine(scope, message, fields));
    },
    error(message, error, fields) {
      const detail = formatError(error);
      console.error(detail ? `${formatLine(scope, message, fields)}: ${detail}` : formatLine(scope, message, fields));
    },
  };
}

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_TIMEOUT = 3;
export const EXIT_NETWORK = 4;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT_USAGE,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}

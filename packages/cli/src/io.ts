import { homedir } from "node:os";
import { stdin, stdout, stderr } from "node:process";

export interface Writer {
  write(chunk: string): void;
}

export interface CliIo {
  out: Writer;
  err: Writer;
  stdin: NodeJS.ReadStream;
  env: NodeJS.ProcessEnv;
  cwd: string;
  now: () => number;
  isStdoutTty: boolean;
  isStdinTty: boolean;
  homedir: () => string;
}

export function defaultIo(env: NodeJS.ProcessEnv = process.env): CliIo {
  return {
    out: { write: (chunk) => stdout.write(chunk) },
    err: { write: (chunk) => stderr.write(chunk) },
    stdin,
    env,
    cwd: process.cwd(),
    now: () => Date.now(),
    isStdoutTty: Boolean(stdout.isTTY),
    isStdinTty: Boolean(stdin.isTTY),
    homedir,
  };
}

export function writeLine(writer: Writer, line: string): void {
  writer.write(line.endsWith("\n") ? line : `${line}\n`);
}

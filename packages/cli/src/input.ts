import readline from "node:readline";
import type { CliIo } from "./io.js";

export async function readAllStdin(io: CliIo): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of io.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

export function question(io: CliIo, prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: io.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function asTty(input: NodeJS.ReadableStream): NodeJS.ReadStream | null {
  const stream = input as NodeJS.ReadStream;
  return typeof stream.setRawMode === "function" ? stream : null;
}

export function readHidden(io: CliIo, prompt: string): Promise<string> {
  const tty = asTty(io.stdin);
  if (!tty || !io.isStdinTty) {
    return question(io, prompt);
  }
  io.out.write(prompt);
  tty.setRawMode(true);
  tty.resume();
  tty.setEncoding("utf8");
  let value = "";
  return new Promise((resolve, reject) => {
    const onData = (chunk: string | Buffer) => {
      const text = String(chunk);
      for (const char of text) {
        if (char === "\n" || char === "\r") {
          cleanup();
          io.out.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          reject(new Error("interrupted"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= " ") {
          value += char;
        }
      }
    };
    const cleanup = () => {
      tty.off("data", onData);
      tty.setRawMode(false);
    };
    tty.on("data", onData);
  });
}

export async function resolvePrompt(args: string[], io: CliIo): Promise<string> {
  const fromArgs = args.join(" ").trim();
  if (fromArgs) {
    return fromArgs;
  }
  if (!io.isStdinTty) {
    return readAllStdin(io);
  }
  return "";
}

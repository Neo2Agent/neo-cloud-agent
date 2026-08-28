import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

export type SmtpMailInput = {
  host: string;
  port?: number;
  user?: string;
  pass?: string;
  from: string;
  to: string;
  subject: string;
  text: string;
};

export function smtpAuthPlain(user: string, pass: string): string {
  return Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64");
}

function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function isFinalReply(line: string): boolean {
  return /^\d{3} /.test(line);
}

async function readReply(socket: Socket, buffer: { text: string }, expect: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const chunks = buffer.text.split(/\r?\n/);
    const finishedAt = chunks.findIndex(isFinalReply);
    if (finishedAt >= 0) {
      const lines = chunks.slice(0, finishedAt + 1);
      buffer.text = chunks.slice(finishedAt + 1).join("\n");
      const reply = lines.join("\n");
      const code = Number(lines[finishedAt]?.slice(0, 3));
      if (!Number.isFinite(code) || Math.floor(code / 100) !== Math.floor(expect / 100)) {
        throw new Error(`smtp ${code || "?"} ${lines[finishedAt]?.slice(4) ?? reply}`.trim());
      }
      return reply;
    }
    const chunk = await new Promise<Buffer>((resolve, reject) => {
      const onData = (data: Buffer) => {
        socket.off("error", onErr);
        socket.off("timeout", onTimeout);
        resolve(data);
      };
      const onErr = (error: Error) => {
        socket.off("data", onData);
        socket.off("timeout", onTimeout);
        reject(error);
      };
      const onTimeout = () => {
        socket.off("data", onData);
        socket.off("error", onErr);
        reject(new Error("smtp timeout"));
      };
      socket.once("data", onData);
      socket.once("error", onErr);
      socket.once("timeout", onTimeout);
    });
    buffer.text += chunk.toString("utf8");
  }
  throw new Error("smtp timeout");
}

async function sendLine(socket: Socket, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(`${line}\r\n`, (error) => (error ? reject(error) : resolve()));
  });
}

async function connectSmtp(host: string, port: number, implicitTls: boolean): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = implicitTls
      ? tlsConnect({ host, port, servername: host })
      : netConnect({ host, port });
    socket.setTimeout(15_000);
    socket.once("error", reject);
    socket.once(implicitTls ? "secureConnect" : "connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
  });
}

async function upgradeTls(socket: Socket, host: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const next = tlsConnect({ socket, host, servername: host });
    next.setTimeout(15_000);
    next.once("error", reject);
    next.once("secureConnect", () => {
      next.off("error", reject);
      resolve(next);
    });
  });
}

export async function sendSmtpMail(input: SmtpMailInput): Promise<void> {
  const host = input.host.trim();
  const port = Number(input.port ?? 587) || 587;
  if (!host || !input.from.trim() || !input.to.trim()) {
    throw new Error("smtp host, from, and to are required");
  }
  let socket = await connectSmtp(host, port, port === 465);
  const buffer = { text: "" };
  try {
    await readReply(socket, buffer, 220);
    await sendLine(socket, `EHLO neo-cloud-agent`);
    const ehlo = await readReply(socket, buffer, 250);
    if (port !== 465 && /STARTTLS/i.test(ehlo)) {
      await sendLine(socket, "STARTTLS");
      await readReply(socket, buffer, 220);
      socket = await upgradeTls(socket, host);
      buffer.text = "";
      await sendLine(socket, `EHLO neo-cloud-agent`);
      await readReply(socket, buffer, 250);
    }
    if (input.user && input.pass) {
      await sendLine(socket, `AUTH PLAIN ${smtpAuthPlain(input.user, input.pass)}`);
      await readReply(socket, buffer, 235);
    }
    await sendLine(socket, `MAIL FROM:<${headerSafe(input.from)}>`);
    await readReply(socket, buffer, 250);
    await sendLine(socket, `RCPT TO:<${headerSafe(input.to)}>`);
    await readReply(socket, buffer, 250);
    await sendLine(socket, "DATA");
    await readReply(socket, buffer, 354);
    const body = [
      `From: ${headerSafe(input.from)}`,
      `To: ${headerSafe(input.to)}`,
      `Subject: ${headerSafe(input.subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.text.replace(/^\./gm, ".."),
      ".",
    ].join("\r\n");
    await new Promise<void>((resolve, reject) => {
      socket.write(`${body}\r\n`, (error) => (error ? reject(error) : resolve()));
    });
    await readReply(socket, buffer, 250);
    await sendLine(socket, "QUIT");
    try {
      await readReply(socket, buffer, 221);
    } catch {
      // some servers hang up after QUIT
    }
  } finally {
    socket.destroy();
  }
}

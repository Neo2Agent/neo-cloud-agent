import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TOOLS_CHANNEL_VERSION, isToolsChannelFrame, type StartTurnRequest, type ToolsChannelFrame } from "@neo-cloud-agent/contracts";
import { ToolsServer } from "../../worker/src/tools-server.js";
import { createLoopServer, listen } from "./server.js";

type CompletionBody = {
  choices: Array<{ message: { role: "assistant"; content?: string; tool_calls?: unknown[] } }>;
  usage: { prompt_tokens: number; completion_tokens: number };
};

function toolCall(name: string, args: Record<string, unknown>) {
  return {
    id: `call-${name}-${Math.random().toString(16).slice(2)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function completion(message: { content?: string; tool_calls?: unknown[] }): CompletionBody {
  return {
    choices: [{ message: { role: "assistant", ...message } }],
    usage: { prompt_tokens: 3, completion_tokens: 2 },
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function listenHttp(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void handler(req, res).catch((error: unknown) => {
      res.writeHead(500);
      res.end(error instanceof Error ? error.message : "error");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
      });
    });
  });
}

test("a remote turn reads a file, runs bash in the desk folder, and the next turn keeps the session", async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "neo-loop-")));
  writeFileSync(path.join(root, "note.txt"), "hello-from-desk");
  const events: Array<{ kind?: string; data?: { output?: string; delta?: string } }> = [];
  let session: Record<string, unknown> = {};
  let completed: { cancelled?: boolean; status?: string } | undefined;
  const modelMessages: unknown[][] = [];
  let releaseFirst: () => void = () => {};
  const firstHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let markFirst: () => void = () => {};
  const firstArrived = new Promise<void>((resolve) => {
    markFirst = resolve;
  });
  let replies = 0;

  const control = await listenHttp(async (req, res) => {
    const raw = await readBody(req);
    if (req.url?.endsWith("/events")) {
      const body = JSON.parse(raw) as { events: typeof events };
      events.push(...body.events);
      res.writeHead(202);
      res.end("{}");
      return;
    }
    if (req.url?.endsWith("/turn-heartbeat")) {
      res.writeHead(202);
      res.end("{}");
      return;
    }
    if (req.url?.endsWith("/turn-complete")) {
      completed = JSON.parse(raw) as { cancelled?: boolean; status?: string };
      res.writeHead(202);
      res.end("{}");
      return;
    }
    if (req.url?.endsWith("/loop-session") && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ state: session }));
      return;
    }
    if (req.url?.endsWith("/loop-session") && req.method === "POST") {
      session = (JSON.parse(raw) as { state: Record<string, unknown> }).state;
      res.writeHead(202);
      res.end("{}");
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const gateway = await listenHttp(async (req, res) => {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as { messages: unknown[] };
    modelMessages.push(body.messages);
    replies += 1;
    if (replies === 1) {
      markFirst();
      await firstHeld;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(completion({ tool_calls: [toolCall("read", { path: "note.txt" })] })));
      return;
    }
    if (replies === 2) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(completion({ tool_calls: [toolCall("bash", { command: "pwd" })] })));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(completion({ content: "done" })));
  });

  const loop = createLoopServer();
  const port = await listen(loop, 0);
  const runId = "run-remote-1";
  const seen: ToolsChannelFrame[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/internal/tools/${runId}`);
  let tools: ToolsServer | undefined;
  const opened = new Promise<void>((resolve) => {
    socket.addEventListener("open", () => {
      tools = new ToolsServer({
        runId,
        sandboxRoot: root,
        send: (frame) => socket.send(JSON.stringify(frame)),
      });
      tools.hello();
      resolve();
    });
  });
  socket.addEventListener("message", (event) => {
    const parsed: unknown = JSON.parse(String(event.data));
    if (!isToolsChannelFrame(parsed) || !tools) {
      return;
    }
    seen.push(parsed);
    tools.handle(parsed);
  });

  try {
    await opened;
    const request: StartTurnRequest = {
      runId,
      turnId: "turn-1",
      orgId: "org",
      userId: "user",
      delivery: "prompt",
      text: "look around",
      model: "neo/mock",
      jwt: "jwt-1",
      llmGatewayUrl: gateway.url,
      controlPlaneUrl: control.url,
      tools: { mode: "worker_ws", url: "inbound", sandboxRoot: "." },
    };
    const started = await fetch(`http://127.0.0.1:${port}/internal/loop/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    assert.equal(started.status, 202);
    await firstArrived;
    await fetch(`http://127.0.0.1:${port}/internal/loop/turns/turn-1/signal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "steer", text: "also say the path" }),
    });
    releaseFirst();
    await waitFor(() => completed?.status === "idle");
    assert.equal(completed?.cancelled, false);
    assert.equal(events.some((event) => event.kind === "tool.start"), true);
    assert.equal(events.some((event) => event.kind === "message.delta" && event.data?.delta === "done"), true);
    assert.equal(seen.some((frame) => frame.type === "exec" && "cwd" in frame && frame.cwd === "/workspace"), false);
    const pwd = events.find((event) => event.kind === "tool.end" && event.data?.output?.includes(root));
    assert.ok(pwd, "bash pwd should run in the desk folder");
    assert.match(JSON.stringify(modelMessages[1]), /also say the path/);
    assert.match(JSON.stringify(session), /hello-from-desk/);

    completed = undefined;
    const followUp: StartTurnRequest = { ...request, turnId: "turn-2", text: "what did you read?" };
    const second = await fetch(`http://127.0.0.1:${port}/internal/loop/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(followUp),
    });
    assert.equal(second.status, 202);
    await waitFor(() => completed?.status === "idle");
    const followMessages = modelMessages.at(-1);
    assert.match(JSON.stringify(followMessages), /hello-from-desk/);
    assert.equal(readFileSync(path.join(root, "note.txt"), "utf8"), "hello-from-desk");
  } finally {
    tools?.dispose();
    socket.close();
    await loop.close();
    await gateway.close();
    await control.close();
  }
});

test("abort cancels the turn and sends abort_all without a successful exec", async () => {
  const events: Array<{ kind?: string }> = [];
  let completed: { cancelled?: boolean; status?: string } | undefined;
  const control = await listenHttp(async (req, res) => {
    const raw = await readBody(req);
    if (req.url?.endsWith("/events")) {
      events.push(...(JSON.parse(raw) as { events: typeof events }).events);
    }
    if (req.url?.endsWith("/turn-complete")) {
      completed = JSON.parse(raw) as { cancelled?: boolean; status?: string };
    }
    if (req.url?.endsWith("/loop-session") && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ state: {} }));
      return;
    }
    res.writeHead(202);
    res.end("{}");
  });
  const gateway = await listenHttp(async (_req, res) => {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 30_000);
      res.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
  const loop = createLoopServer();
  const port = await listen(loop, 0);
  const runId = "run-abort";
  const seen: ToolsChannelFrame[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/internal/tools/${runId}`);
  const opened = new Promise<void>((resolve) => {
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ v: TOOLS_CHANNEL_VERSION, type: "hello", runId, role: "tools", sandboxRoot: "/tmp" }));
      resolve();
    });
  });
  socket.addEventListener("message", (event) => {
    const parsed: unknown = JSON.parse(String(event.data));
    if (isToolsChannelFrame(parsed)) {
      seen.push(parsed);
    }
  });
  try {
    await opened;
    await fetch(`http://127.0.0.1:${port}/internal/loop/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId,
        turnId: "turn-abort",
        orgId: "org",
        userId: "user",
        delivery: "prompt",
        text: "wait",
        model: "neo/mock",
        jwt: "jwt",
        llmGatewayUrl: gateway.url,
        controlPlaneUrl: control.url,
        tools: { mode: "worker_ws", url: "inbound", sandboxRoot: "." },
      }),
    });
    await waitFor(
      () => events.some((event) => event.kind === "agent.start"),
      () => JSON.stringify({ events, completed, frames: seen.map((frame) => frame.type) }),
    );
    await fetch(`http://127.0.0.1:${port}/internal/loop/turns/turn-abort/signal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "abort" }),
    });
    await waitFor(() => completed?.cancelled === true);
    assert.equal(completed?.status, "idle");
    assert.equal(seen.some((frame) => frame.type === "abort_all"), true);
    assert.equal(seen.some((frame) => frame.type === "exec"), false);
  } finally {
    socket.close();
    await loop.close();
    await gateway.close();
    await control.close();
  }
});

test("a missing loop token rejects the turn and never opens a tool call", async () => {
  const loop = createLoopServer({ token: "secret" });
  const port = await listen(loop, 0);
  const seen: string[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/internal/tools/run-locked`);
  socket.addEventListener("message", () => {
    seen.push("frame");
  });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/internal/loop/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "run-locked", turnId: "turn-locked", text: "no" }),
    });
    assert.equal(response.status, 401);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(seen, []);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal((await health.json() as { service: string }).service, "neo-loop");
  } finally {
    socket.close();
    await loop.close();
  }
});

async function waitFor(ready: () => boolean, detail?: () => string): Promise<void> {
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > 8000) {
      throw new Error(`timed out waiting for the loop ${detail ? detail() : ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

import { createHmac, randomUUID } from "node:crypto";

export const IAT_HOST = "iat-api.xfyun.cn";
export const IAT_PATH = "/v2/iat";

export type IatStatus = 0 | 1 | 2;

export type IatCredentials = {
  appId: string;
  apiKey: string;
  apiSecret: string;
};

export type IatFrame = {
  common?: { app_id: string };
  business?: {
    language: string;
    domain: string;
    accent: string;
    vad_eos: number;
    dwa: string;
  };
  data: {
    status: IatStatus;
    format: string;
    encoding: string;
    audio: string;
  };
};

export function readIatCredentials(): IatCredentials | null {
  const appId = (process.env.IFLYTEK_APP_ID ?? "").trim();
  const apiKey = (process.env.IFLYTEK_API_KEY ?? "").trim();
  const apiSecret = (process.env.IFLYTEK_API_SECRET ?? "").trim();
  if (!appId || !apiKey || !apiSecret) return null;
  return { appId, apiKey, apiSecret };
}

export function iatConfigured(): boolean {
  return readIatCredentials() !== null;
}

export function rfc1123Date(at = new Date()): string {
  return at.toUTCString();
}

export function buildIatWebSocketUrl(credentials: IatCredentials, date: string): string {
  const signatureOrigin = `host: ${IAT_HOST}\ndate: ${date}\nGET ${IAT_PATH} HTTP/1.1`;
  const signature = createHmac("sha256", credentials.apiSecret).update(signatureOrigin).digest("base64");
  const authorizationOrigin = `api_key="${credentials.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString("base64");
  const query = new URLSearchParams({ authorization, date, host: IAT_HOST });
  return `wss://${IAT_HOST}${IAT_PATH}?${query.toString()}`;
}

export function encodeIatFrame(appId: string, status: IatStatus, audioB64 = ""): IatFrame {
  const data = {
    status,
    format: "audio/L16;rate=16000",
    encoding: "raw",
    audio: audioB64,
  };
  if (status !== 0) return { data };
  return {
    common: { app_id: appId },
    business: {
      language: "zh_cn",
      domain: "iat",
      accent: "mandarin",
      vad_eos: 3000,
      dwa: "wpgs",
    },
    data,
  };
}

export type IatParse = {
  text: string;
  status: number;
  pgs?: string;
};

export function decodeIatResult(payload: unknown): IatParse {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : {};
  const result = data.result && typeof data.result === "object" ? (data.result as Record<string, unknown>) : {};
  const words = Array.isArray(result.ws) ? result.ws : [];
  const text = words
    .flatMap((item) => {
      const row = item && typeof item === "object" ? (item as { cw?: Array<{ w?: string }> }) : {};
      return (row.cw ?? []).map((part) => part.w ?? "");
    })
    .join("");
  const status = typeof data.status === "number" ? data.status : 0;
  const pgs = typeof result.pgs === "string" ? result.pgs : undefined;
  return { text, status, pgs };
}

export function applyIatTranscript(
  current: { committed: string; last: string },
  parsed: IatParse,
): { committed: string; last: string; text: string } {
  if (parsed.pgs === "rpl") {
    return { committed: current.committed, last: parsed.text, text: `${current.committed}${parsed.text}` };
  }
  if (parsed.status === 2) {
    const committed = `${current.committed}${parsed.text || current.last}`;
    return { committed, last: "", text: committed };
  }
  if (parsed.pgs === "apd") {
    const committed = `${current.committed}${current.last}`;
    return { committed, last: parsed.text, text: `${committed}${parsed.text}` };
  }
  return { committed: current.committed, last: parsed.text, text: `${current.committed}${parsed.text}` };
}

export type IatSocket = {
  send: (data: string) => void;
  close: () => void;
  addEventListener: (type: "message" | "error" | "close" | "open", listener: (event: { data?: string }) => void) => void;
};

export type IatConnect = (url: string) => IatSocket;

export type SpeechIatRequest = {
  sessionId?: string;
  audio?: string;
  status: IatStatus;
};

export type SpeechIatResponse = {
  sessionId: string;
  text: string;
  done?: boolean;
  error?: string;
};

type Session = {
  id: string;
  socket: IatSocket;
  opened: Promise<void>;
  committed: string;
  last: string;
  pending: string[];
  done: boolean;
  timer: ReturnType<typeof setTimeout>;
};

const sessions = new Map<string, Session>();
const SESSION_MS = 70_000;

export function resetIatSessions(): void {
  for (const session of sessions.values()) {
    clearTimeout(session.timer);
    try {
      session.socket.close();
    } catch {
      /* ignore */
    }
  }
  sessions.clear();
}

function defaultConnect(url: string): IatSocket {
  const ws = new WebSocket(url);
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    addEventListener: (type, listener) => {
      ws.addEventListener(type, (event) => {
        listener({ data: typeof (event as MessageEvent).data === "string" ? (event as MessageEvent).data : undefined });
      });
    },
  };
}

function touch(session: Session): void {
  clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    sessions.delete(session.id);
    try {
      session.socket.close();
    } catch {
      /* ignore */
    }
  }, SESSION_MS);
}

function attachSocket(session: Session): void {
  session.socket.addEventListener("message", (event) => {
    if (!event.data) return;
    try {
      const parsed = decodeIatResult(JSON.parse(event.data) as unknown);
      const next = applyIatTranscript({ committed: session.committed, last: session.last }, parsed);
      session.committed = next.committed;
      session.last = next.last;
      session.pending.push(next.text);
      if (parsed.status === 2) session.done = true;
    } catch {
      /* ignore malformed upstream frames */
    }
  });
  session.socket.addEventListener("close", () => {
    session.done = true;
  });
}

async function openSession(credentials: IatCredentials, connect: IatConnect): Promise<Session> {
  const url = buildIatWebSocketUrl(credentials, rfc1123Date());
  const socket = connect(url);
  const opened = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("听写服务连不上")), 8_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("听写服务不可用"));
    });
  });
  const session: Session = {
    id: randomUUID(),
    socket,
    opened,
    committed: "",
    last: "",
    pending: [],
    done: false,
    timer: setTimeout(() => undefined, SESSION_MS),
  };
  attachSocket(session);
  touch(session);
  sessions.set(session.id, session);
  await opened;
  return session;
}

function flushText(session: Session): string {
  const last = session.pending.at(-1);
  session.pending = [];
  return last ?? `${session.committed}${session.last}`;
}

async function waitBriefly(session: Session): Promise<void> {
  if (session.pending.length || session.done) return;
  await new Promise((resolve) => setTimeout(resolve, 80));
}

export async function handleIatRequest(
  body: SpeechIatRequest,
  connect: IatConnect = defaultConnect,
): Promise<{ status: number; body: SpeechIatResponse | { error: string } }> {
  const credentials = readIatCredentials();
  if (!credentials) {
    return { status: 503, body: { error: "听写未配置" } };
  }
  const status = body.status;
  if (status !== 0 && status !== 1 && status !== 2) {
    return { status: 400, body: { error: "invalid_status" } };
  }
  try {
    const session =
      status === 0
        ? await openSession(credentials, connect)
        : sessions.get(body.sessionId ?? "");
    if (!session) {
      return { status: 404, body: { error: "听写会话不存在" } };
    }
    touch(session);
    session.socket.send(JSON.stringify(encodeIatFrame(credentials.appId, status, body.audio ?? "")));
    if (status === 2) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const text = flushText(session);
      sessions.delete(session.id);
      clearTimeout(session.timer);
      try {
        session.socket.close();
      } catch {
        /* ignore */
      }
      return { status: 200, body: { sessionId: session.id, text, done: true } };
    }
    await waitBriefly(session);
    return { status: 200, body: { sessionId: session.id, text: flushText(session), done: session.done } };
  } catch (error) {
    return { status: 502, body: { error: error instanceof Error ? error.message : "听写服务不可用" } };
  }
}

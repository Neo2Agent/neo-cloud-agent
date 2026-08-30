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
  ls?: boolean;
};

/** 16 kHz s16le × 40ms. Gateway splits larger HTTP bodies into these for 讯飞. */
export const IAT_WS_FRAME_BYTES = 1280;

const IAT_PUNCT = /^[\s\p{P}\p{S}]+$/u;

export function isIatPunctuation(text: string): boolean {
  return Boolean(text) && IAT_PUNCT.test(text);
}

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
  const ls = typeof result.ls === "boolean" ? result.ls : undefined;
  return { text, status, pgs, ls };
}

function joinIat(committed: string, last: string): string {
  return `${committed}${last}`;
}

function appendPunctuation(current: { committed: string; last: string }, mark: string): {
  committed: string;
  last: string;
  text: string;
} {
  if (current.last) {
    const last = current.last.endsWith(mark) ? current.last : `${current.last}${mark}`;
    return { committed: current.committed, last, text: joinIat(current.committed, last) };
  }
  const committed = current.committed.endsWith(mark) ? current.committed : `${current.committed}${mark}`;
  return { committed, last: "", text: committed };
}

export function applyIatTranscript(
  current: { committed: string; last: string },
  parsed: IatParse,
): { committed: string; last: string; text: string } {
  // 讯飞常把句号/问号单独成一包。rpl/默认路径若整段替换 last，预览会闪成「？」。
  if (parsed.text && isIatPunctuation(parsed.text) && (current.last || current.committed)) {
    const next = appendPunctuation(current, parsed.text);
    if (parsed.status === 2) {
      return { committed: next.text, last: "", text: next.text };
    }
    return next;
  }
  if (parsed.pgs === "rpl") {
    return { committed: current.committed, last: parsed.text, text: joinIat(current.committed, parsed.text) };
  }
  if (parsed.status === 2) {
    const piece = parsed.text || current.last;
    const committed = `${current.committed}${piece}`;
    return { committed, last: "", text: committed };
  }
  if (parsed.pgs === "apd" || parsed.ls) {
    const committed = `${current.committed}${current.last}`;
    return { committed, last: parsed.text, text: joinIat(committed, parsed.text) };
  }
  return { committed: current.committed, last: parsed.text, text: joinIat(current.committed, parsed.text) };
}

export function splitIatAudio(audioB64: string): string[] {
  if (!audioB64) return [""];
  const buf = Buffer.from(audioB64, "base64");
  if (buf.length <= IAT_WS_FRAME_BYTES) return [audioB64];
  const out: string[] = [];
  for (let offset = 0; offset < buf.length; offset += IAT_WS_FRAME_BYTES) {
    out.push(buf.subarray(offset, offset + IAT_WS_FRAME_BYTES).toString("base64"));
  }
  return out;
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
  write: Promise<void>;
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
    write: Promise.resolve(),
    timer: setTimeout(() => undefined, SESSION_MS),
  };
  attachSocket(session);
  touch(session);
  sessions.set(session.id, session);
  await opened;
  return session;
}

function currentText(session: Session): string {
  return `${session.committed}${session.last}` || (session.pending.at(-1) ?? "");
}

function frameStatus(requestStatus: IatStatus, index: number, last: boolean): IatStatus {
  if (requestStatus === 2 && last) return 2;
  if (requestStatus === 0 && index === 0) return 0;
  return 1;
}

async function sendAudio(session: Session, appId: string, status: IatStatus, audioB64: string): Promise<void> {
  const chunks = splitIatAudio(audioB64);
  const previous = session.write;
  let release: () => void = () => undefined;
  session.write = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const last = index === chunks.length - 1;
      session.socket.send(JSON.stringify(encodeIatFrame(appId, frameStatus(status, index, last), chunks[index] ?? "")));
    }
  } finally {
    release();
  }
}

async function waitForFinal(session: Session, timeoutMs = 1_500): Promise<void> {
  const started = Date.now();
  while (!session.done && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
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
    await sendAudio(session, credentials.appId, status, body.audio ?? "");
    if (status === 2) {
      await waitForFinal(session);
      const text = currentText(session);
      sessions.delete(session.id);
      clearTimeout(session.timer);
      try {
        session.socket.close();
      } catch {
        /* ignore */
      }
      return { status: 200, body: { sessionId: session.id, text, done: true } };
    }
    return { status: 200, body: { sessionId: session.id, text: currentText(session), done: session.done } };
  } catch (error) {
    return { status: 502, body: { error: error instanceof Error ? error.message : "听写服务不可用" } };
  }
}

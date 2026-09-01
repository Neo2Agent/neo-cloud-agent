import { deskBridge, withApiBase, withDeskClient } from "./desk";

export function apiHeaders(token: string, json = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export async function api(token: string, url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(withApiBase(withDeskClient(url)), {
    ...options,
    credentials: "same-origin",
    headers: { ...apiHeaders(token, Boolean(options.body)), ...options.headers },
  });
}

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export type SpeechIatBody = {
  sessionId?: string;
  audio?: string;
  status: 0 | 1 | 2;
};

export type SpeechIatReply = {
  sessionId: string;
  text: string;
  done?: boolean;
  error?: string;
};

async function readApiJson<T extends { error?: string }>(response: Response, fallback: string): Promise<T> {
  const body = await readJson<T>(response);
  if (!response.ok) throw new Error(body.error || fallback);
  return body;
}

export async function speechStatus(token: string): Promise<{ configured: boolean }> {
  const response = await api(token, "/v1/speech/iat");
  return readApiJson<{ configured: boolean; error?: string }>(response, "听写服务不可用");
}

export async function speechIat(token: string, body: SpeechIatBody): Promise<SpeechIatReply> {
  const response = await api(token, "/v1/speech/iat", { method: "POST", body: JSON.stringify(body) });
  return readApiJson<SpeechIatReply>(response, "听写服务不可用");
}

export function persistSessionToken(token: string): void {
  const desk = deskBridge();
  if (desk) {
    void (token ? desk.setToken(token) : desk.clearToken());
  }
}

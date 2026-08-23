import { deskBridge, withApiBase } from "./desk";

export function apiHeaders(token: string, json = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export async function api(token: string, url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(withApiBase(url), {
    ...options,
    credentials: "same-origin",
    headers: { ...apiHeaders(token, Boolean(options.body)), ...options.headers },
  });
}

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function persistSessionToken(token: string): void {
  const desk = deskBridge();
  if (desk) {
    void (token ? desk.setToken(token) : desk.clearToken());
  }
}

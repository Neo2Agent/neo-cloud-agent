import { deskBridge, withApiBase } from "./desk";

const TOKEN_KEY = "neo.apiToken.v2";

export function readToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function writeToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  const desk = deskBridge();
  if (desk) {
    void (token ? desk.setToken(token) : desk.clearToken());
  }
}

export async function hydrateDeskToken(): Promise<string> {
  const desk = deskBridge();
  if (!desk) {
    return readToken();
  }
  const fromDesk = (await desk.getToken().catch(() => "")) || "";
  if (fromDesk) {
    localStorage.setItem(TOKEN_KEY, fromDesk);
    return fromDesk;
  }
  return readToken();
}

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

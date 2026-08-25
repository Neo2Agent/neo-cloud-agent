const TOKEN_KEY = "neo.admin.token.v1";

export function readToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function writeToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Caddy serves the console at `/admin/`; APIs must stay under that prefix. */
export function apiPrefix(pathname = typeof location === "undefined" ? "/" : location.pathname): string {
  return pathname === "/admin" || pathname.startsWith("/admin/") ? "/admin" : "";
}

export function apiUrl(path: string, pathname?: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${apiPrefix(pathname)}${suffix}`;
}

export async function api(token: string, url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(url), {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

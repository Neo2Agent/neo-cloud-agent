import type { CloudToolContext } from "./types.js";

export async function callControlPlane<T>(
  ctx: CloudToolContext,
  pathname: string,
  init: RequestInit = {},
): Promise<T> {
  const fetchFn = ctx.fetch ?? globalThis.fetch;
  const url = `${ctx.controlPlaneUrl.replace(/\/$/, "")}${pathname}`;
  const headers = new Headers(init.headers);
  if (ctx.jwt) {
    headers.set("authorization", `Bearer ${ctx.jwt}`);
  }
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetchFn(url, { ...init, headers });
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { error: text };
    }
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

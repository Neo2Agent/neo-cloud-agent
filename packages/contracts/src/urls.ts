/** True when the URL points at this machine. Desk may then dial neo-loop directly. */
export function isLoopbackHttpUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) {
    return false;
  }
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

/** Control-plane tools WSS path. Caddy must proxy this, never `:8082`. */
export function deskToolsProxyUrl(controlPlaneUrl: string, deskId: string, runId: string): string {
  const base = controlPlaneUrl.replace(/\/$/, "");
  return `${base}/v1/desks/${encodeURIComponent(deskId)}/tools/${encodeURIComponent(runId)}`;
}

export function isDeskToolsProxyUrl(url: string | undefined | null): boolean {
  if (!url) {
    return false;
  }
  return /\/v1\/desks\/[^/]+\/tools\/[^/?#]+/.test(url);
}

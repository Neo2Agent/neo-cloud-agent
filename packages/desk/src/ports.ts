/** Desk's own Vite port. Deliberately not the Web UI's 5173, so both can run. */
export const DEFAULT_DESK_UI_PORT = 5174;

/**
 * The packaged app talks to the production IP.
 *
 * The hostname HTTP 308s onto a TLS endpoint the Electron net stack cannot
 * complete, so the IP is the address, not a fallback.
 */
export const DEFAULT_PRODUCTION_CONTROL_PLANE = "http://62.234.211.200";

export function isDeskPackaged(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEO_DESK_PACKAGED === "1";
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return true;
  }
}

export function controlPlaneOrigin(env: NodeJS.ProcessEnv = process.env, opts: { production?: boolean } = {}): string {
  return deskClientOrigin(env, { production: opts.production ?? isDeskPackaged(env) });
}

export function deskClientOrigin(env: NodeJS.ProcessEnv = process.env, opts: { production?: boolean } = {}): string {
  const neo = (env.NEO_CONTROL_PLANE_URL || "").replace(/\/$/, "");
  if (opts.production || isDeskPackaged(env)) {
    if (neo && !isLoopbackOrigin(neo)) return neo;
    return DEFAULT_PRODUCTION_CONTROL_PLANE;
  }
  return (neo || env.CONTROL_PLANE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
}

/** Origins a packaged build health-checks, best first, without repeats. */
export function productionControlPlaneCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const preferred = deskClientOrigin(env, { production: true });
  return [...new Set([preferred, DEFAULT_PRODUCTION_CONTROL_PLANE])];
}

/** Paths the packaged renderer must send through the main-process proxy. */
export function isDeskApiProxyPath(pathname: string): boolean {
  return pathname === "/health" || pathname.startsWith("/v1/");
}

/** Vite URL from `pnpm dev:desk`. Empty means Electron should load `ui/dist` via `neo-desk://`. */
export function deskRendererUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEO_DESK_URL || "").replace(/\/$/, "");
}

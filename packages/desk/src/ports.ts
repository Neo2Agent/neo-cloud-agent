export const DEFAULT_WEB_UI_PORT = 5173;
export const DEFAULT_DESK_UI_PORT = 5174;
export const DEFAULT_PRODUCTION_CONTROL_PLANE = "http://62.234.211.200";

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return true;
  }
}

export function controlPlaneOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return deskClientOrigin(env);
}

export function deskClientOrigin(env: NodeJS.ProcessEnv = process.env, opts: { production?: boolean } = {}): string {
  const neo = (env.NEO_CONTROL_PLANE_URL || "").replace(/\/$/, "");
  if (opts.production) {
    if (neo && !isLoopbackOrigin(neo)) return neo;
    return DEFAULT_PRODUCTION_CONTROL_PLANE;
  }
  return (neo || env.CONTROL_PLANE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
}

/** Vite URL from `pnpm dev:desk`. Empty means Electron should load `ui/dist` via `neo-desk://`. */
export function deskRendererUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEO_DESK_URL || "").replace(/\/$/, "");
}

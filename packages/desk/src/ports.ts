export const DEFAULT_DESK_PORT = 8082;
export const DEFAULT_WEB_UI_PORT = 5173;
export const DEFAULT_DESK_UI_PORT = 5174;

export function controlPlaneOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEO_CONTROL_PLANE_URL || env.CONTROL_PLANE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
}

/** Empty string means Electron should keep loading the control-plane origin. */
export function deskRendererUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NEO_DESK_URL) {
    return env.NEO_DESK_URL.replace(/\/$/, "");
  }
  if (env.NEO_DESK_PORT) {
    return `http://127.0.0.1:${Number(env.NEO_DESK_PORT)}`;
  }
  return "";
}

export function deskPreviewListenPort(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.NEO_DESK_PORT || DEFAULT_DESK_PORT);
}

import { type ChildProcess } from "node:child_process";
import { spawnPnpm } from "./spawn-pnpm.ts";
import { repoRoot, waitForHttp } from "./ensure-backend.ts";

export const DEFAULT_WEB_UI_PORT = 5173;
export const DEFAULT_MOBILE_UI_PORT = 5175;

export function webUiUrl(port = DEFAULT_WEB_UI_PORT): string {
  return `http://127.0.0.1:${port}`;
}

export async function isHttpUp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.status > 0;
  } catch {
    return false;
  }
}

/** Reuse a running Web Vite, or start `packages/web`. Mobile shell uses port 5175. */
export async function ensureWebUi(opts: { port?: number; shell?: "desktop" | "mobile"; apiBase?: string } = {}): Promise<{
  url: string;
  child: ChildProcess | null;
}> {
  const port = opts.port ?? DEFAULT_WEB_UI_PORT;
  const url = webUiUrl(port);
  if (await isHttpUp(url)) {
    console.log(`web UI already listening on :${port}`);
    return { url, child: null };
  }
  const shell = opts.shell ?? "desktop";
  console.log(`starting web UI :${port}${shell === "mobile" ? " (phone shell)" : ""}`);
  const child = spawnPnpm(["--filter", "@neo-cloud-agent/web", "dev"], {
    cwd: repoRoot(),
    stdio: "inherit",
    env: {
      ...process.env,
      NEO_WEB_PORT: String(port),
      NEO_SHELL: shell,
      ...(opts.apiBase ? { NEO_CONTROL_PLANE_URL: opts.apiBase } : {}),
    },
  });
  await waitForHttp(url);
  return { url, child };
}

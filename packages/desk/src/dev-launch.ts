import { DEFAULT_DESK_UI_PORT, deskClientOrigin, isLoopbackOrigin } from "./ports.js";

export type DeskDevLaunch = {
  production: boolean;
  label: "预发" | "生产";
  apiBase: string;
  uiPort: number;
  uiUrl: string;
  startLocalBackend: boolean;
};

export function resolveDeskDevLaunch(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
): DeskDevLaunch {
  const production = argv.includes("--prod");
  const apiBase = deskClientOrigin(env, { production });
  const uiPort = Number(env.NEO_DESK_UI_PORT || DEFAULT_DESK_UI_PORT);
  return {
    production,
    label: production ? "生产" : "预发",
    apiBase,
    uiPort,
    uiUrl: `http://127.0.0.1:${uiPort}`,
    startLocalBackend: !production && isLoopbackOrigin(apiBase),
  };
}

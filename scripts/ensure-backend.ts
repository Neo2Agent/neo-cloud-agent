import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status > 0) {
        return;
      }
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

export async function probeHttp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureBackend(): Promise<ChildProcess | null> {
  const controlOk = await probeHttp("http://127.0.0.1:8080/health");
  const gatewayOk = await probeHttp("http://127.0.0.1:8081/health");
  if (controlOk && gatewayOk) {
    console.log("backend already listening on :8080 and :8081");
    return null;
  }

  const filters: string[] = [];
  if (!controlOk) filters.push("@neo-cloud-agent/control-plane");
  if (!gatewayOk) filters.push("@neo-cloud-agent/llm-gateway");
  console.log(
    `starting ${!controlOk ? "control-plane :8080" : ""}${!controlOk && !gatewayOk ? " and " : ""}${!gatewayOk ? "llm-gateway :8081" : ""}`,
  );
  const child = spawn("pnpm", ["--parallel", ...filters.flatMap((name) => ["--filter", name]), "dev"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (!controlOk) await waitForHttp("http://127.0.0.1:8080/health");
  if (!gatewayOk) await waitForHttp("http://127.0.0.1:8081/health");
  return child;
}

export function repoRoot(): string {
  return root;
}

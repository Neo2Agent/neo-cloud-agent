import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

export async function ensureBackend(): Promise<ChildProcess | null> {
  try {
    const response = await fetch("http://127.0.0.1:8080/health");
    if (response.ok) {
      console.log("backend already listening on :8080");
      return null;
    }
  } catch {
    // start it
  }
  console.log("starting control-plane :8080 and llm-gateway :8081");
  const child = spawn(
    "pnpm",
    ["--parallel", "--filter", "@neo-cloud-agent/control-plane", "--filter", "@neo-cloud-agent/llm-gateway", "dev"],
    { cwd: root, stdio: "inherit", env: process.env },
  );
  await waitForHttp("http://127.0.0.1:8080/health");
  return child;
}

export function repoRoot(): string {
  return root;
}

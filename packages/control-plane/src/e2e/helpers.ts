import { spawnSync } from "node:child_process";
import type { Server } from "node:http";

export function listen(server: Server, host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no listen port"));
        return;
      }
      resolve(address.port);
    });
    server.on("error", reject);
  });
}

export function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export async function archiveRun(base: string, runId: string): Promise<void> {
  try {
    await fetch(`${base}/v1/runs/${runId}/archive`, { method: "POST" });
  } catch {
    // control plane may already be gone
  }
}

export function dockerAvailable(): boolean {
  try {
    if (spawnSync("docker", ["info"], { encoding: "utf8", timeout: 4000 }).status === 0) {
      return true;
    }
    return spawnSync("sudo", ["-n", "docker", "info"], { encoding: "utf8", timeout: 4000 }).status === 0;
  } catch {
    return false;
  }
}

export function dockerImageExists(image: string): boolean {
  const args = ["image", "inspect", image];
  const direct = spawnSync("docker", args, { encoding: "utf8" });
  if (direct.status === 0) {
    return true;
  }
  return spawnSync("sudo", ["-n", "docker", ...args], { encoding: "utf8" }).status === 0;
}

export async function waitForRun(
  base: string,
  runId: string,
  timeoutMs: number,
): Promise<{ kinds: string[]; status: string; errorMessage: string | null }> {
  const deadline = Date.now() + timeoutMs;
  let kinds: string[] = [];
  let status = "RUNNING";
  let errorMessage: string | null = null;
  while (Date.now() < deadline) {
    const transcript = (await (await fetch(`${base}/v1/runs/${runId}/transcript`)).json()) as {
      events: Array<{ kind: string }>;
    };
    kinds = transcript.events.map((item) => item.kind);
    const latest = (await (await fetch(`${base}/v1/runs/${runId}`)).json()) as {
      status: string;
      errorMessage: string | null;
    };
    status = latest.status;
    errorMessage = latest.errorMessage;
    if (kinds.includes("agent.end") || status === "ERROR" || status === "IDLE") {
      return { kinds, status, errorMessage };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { kinds, status, errorMessage };
}

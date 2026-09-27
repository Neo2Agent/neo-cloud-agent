import { ensureBackend, repoRoot } from "./ensure-backend.ts";
import { DEFAULT_MOBILE_UI_PORT, ensureWebUi } from "./ensure-web.ts";
import { killSpawned } from "./spawn-pnpm.ts";

async function main(): Promise<void> {
  await ensureBackend();
  const { url, child } = await ensureWebUi({ port: DEFAULT_MOBILE_UI_PORT, shell: "mobile" });
  console.log(`mobile shell on ${url} (Web phone form; control-plane API stays :8080)`);
  if (!child) {
    await new Promise(() => undefined);
    return;
  }
  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => killSpawned(child, "SIGINT"));
  process.on("SIGTERM", () => killSpawned(child, "SIGTERM"));
}

void main();

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export async function withAskpass<T>(password: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-askpass-"));
  const script = path.join(dir, "askpass");
  writeFileSync(
    script,
    `#!/bin/sh
case "$1" in
  *Username*) printf '%s' "x-access-token" ;;
  *) printf '%s' "$NEO_SCM_PASSWORD" ;;
esac
`,
  );
  chmodSync(script, 0o700);
  try {
    return await fn({
      GIT_ASKPASS: script,
      SSH_ASKPASS: script,
      GIT_TERMINAL_PROMPT: "0",
      NEO_SCM_PASSWORD: password,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

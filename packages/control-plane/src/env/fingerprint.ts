import { createHash } from "node:crypto";

export function environmentFingerprint(input: { repoUrls: string[]; ref?: string | null }): string {
  const repos = [...input.repoUrls].map((item) => item.trim()).filter(Boolean).sort();
  const ref = (input.ref ?? "").trim();
  return createHash("sha256").update(JSON.stringify({ repos, ref })).digest("hex");
}

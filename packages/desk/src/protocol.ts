export function runIdFromDeepLink(url: string): string | null {
  const match = /^neo:\/\/(?:runs\/)?([0-9a-f-]{8,})/i.exec(url.trim());
  return match?.[1] ?? null;
}

export function hashForRun(runId: string): string {
  return `#/runs/${runId}`;
}

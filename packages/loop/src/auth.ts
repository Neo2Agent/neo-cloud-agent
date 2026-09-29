import type { IncomingMessage } from "node:http";

/** Empty token allows the call, matching the Java loop's tokenMatches. */
export function tokenMatches(expected: string, presented: string): boolean {
  if (!expected.trim()) {
    return true;
  }
  return expected === presented;
}

export function presentedToken(req: IncomingMessage, url: URL): string {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice("bearer ".length).trim();
  }
  return (url.searchParams.get("token") ?? "").trim();
}

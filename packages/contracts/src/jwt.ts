import { createHmac, timingSafeEqual } from "node:crypto";
import type { LlmRunTokenClaims } from "./llm.js";

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function sign(secret: string, payload: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function mintRunToken(secret: string, claims: Omit<LlmRunTokenClaims, "iss">): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...claims, iss: "neo-llm-gateway" }));
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${sign(secret, unsigned)}`;
}

export function verifyRunToken(secret: string, token: string): LlmRunTokenClaims {
  const [header, body, mac] = token.split(".");
  if (!header || !body || !mac) {
    throw new Error("invalid token");
  }
  const expected = sign(secret, `${header}.${body}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("invalid token signature");
  }
  const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LlmRunTokenClaims;
  if (claims.iss !== "neo-llm-gateway") {
    throw new Error("invalid token issuer");
  }
  if (claims.exp * 1000 < Date.now()) {
    throw new Error("token expired");
  }
  return claims;
}

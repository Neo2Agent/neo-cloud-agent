import { createHmac, timingSafeEqual } from "node:crypto";
import type { LlmRunTokenClaims } from "@neo-cloud-agent/contracts";
import { config } from "./config.js";

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", config.jwtSecret).update(payload).digest());
}

export function mintRunToken(claims: Omit<LlmRunTokenClaims, "iss">): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...claims, iss: "neo-llm-gateway" }));
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifyRunToken(token: string): LlmRunTokenClaims {
  const [header, body, mac] = token.split(".");
  if (!header || !body || !mac) {
    throw new Error("invalid token");
  }
  const expected = sign(`${header}.${body}`);
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

import { verifyRunToken as verify, type LlmRunTokenClaims } from "@neo-cloud-agent/contracts";
import { getConfig } from "./config.js";

export function verifyRunToken(token: string): LlmRunTokenClaims {
  return verify(getConfig().jwtSecret, token);
}

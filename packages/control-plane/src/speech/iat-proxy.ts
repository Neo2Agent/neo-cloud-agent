import { randomUUID } from "node:crypto";
import { mintRunToken } from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";
import type { Actor } from "../security/actor.js";

export type SpeechIatBody = {
  sessionId?: string;
  audio?: string;
  status?: number;
};

export async function speechIatConfigured(): Promise<boolean> {
  try {
    const response = await fetch(`${getConfig().llmGatewayUrl}/health`);
    if (!response.ok) return false;
    const body = (await response.json()) as { iatConfigured?: boolean };
    return body.iatConfigured === true;
  } catch {
    return false;
  }
}

export function mintSpeechGatewayToken(actor: Actor): string {
  const now = Math.floor(Date.now() / 1000);
  return mintRunToken(getConfig().jwtSecret, {
    sub: actor.userId,
    runId: `speech:${actor.userId}`,
    orgId: actor.orgId,
    model: "iflytek-iat",
    exp: now + 120,
    jti: randomUUID(),
  });
}

export async function proxySpeechIat(
  actor: Actor,
  body: SpeechIatBody,
): Promise<{ status: number; payload: unknown }> {
  const token = mintSpeechGatewayToken(actor);
  const response = await fetch(`${getConfig().llmGatewayUrl}/v1/speech/iat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sessionId: body.sessionId,
      audio: body.audio,
      status: body.status,
    }),
  });
  const text = await response.text();
  let payload: unknown = { error: text || "听写服务不可用" };
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { error: text };
    }
  }
  return { status: response.status, payload };
}

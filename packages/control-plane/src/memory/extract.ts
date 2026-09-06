import {
  mintRunToken,
  parseExtractedMemories,
  type MemoryItem,
} from "@neo-cloud-agent/contracts";
import { getUserMemorySettings } from "../accounts/accounts.js";
import { getConfig } from "../config.js";
import { readMem0Info } from "./client.js";
import { addUserMemory, listUserMemories } from "./service.js";

const EXTRACT_SAVE_LIMIT = 8;
const EXTRACT_TRANSCRIPT_MESSAGES = 24;
const EXTRACT_MESSAGE_CHARS = 800;
const EXTRACT_GATEWAY_TIMEOUT_MS = 20_000;

export const USER_MEMORY_EXTRACT_PROMPT = [
  "Extract only cross-project user coding tendencies from this conversation.",
  "Return a JSON array of {\"text\",\"kind\"} objects. kind must be style, habit, or coding.",
  "style = coding style tendencies. habit = collaboration rhythm. coding = toolchain facts that stay true in another repo.",
  "Write fuzzy one-liners using 倾向 / 通常. Never write 必须 / 从不 / 永远 / 讨厌.",
  "Do not extract family, health, mood, relationships, project names, module nicknames, architecture decisions, or idle-slot / repo-specific facts.",
  "If unsure, return []. Current task must remain able to override every item.",
].join(" ");

export function formatTranscriptForExtract(messages: Array<{ role?: string; text?: string }>): string {
  return messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.text?.trim())
    .slice(-EXTRACT_TRANSCRIPT_MESSAGES)
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${(message.text ?? "").trim().slice(0, EXTRACT_MESSAGE_CHARS)}`)
    .join("\n");
}

export type ExtractComplete = (prompt: string) => Promise<string>;

let extractComplete: ExtractComplete = completeViaGateway;

export function setExtractCompleteForTests(fn: ExtractComplete | null): void {
  extractComplete = fn ?? completeViaGateway;
}

async function completeViaGateway(prompt: string): Promise<string> {
  const config = getConfig();
  const token = mintRunToken(config.jwtSecret, {
    sub: "memory-extract",
    runId: "memory-extract",
    orgId: config.orgId,
    model: config.defaultModel,
    exp: Math.floor(Date.now() / 1000) + 120,
    jti: `memory-extract-${Date.now()}`,
  });
  const response = await fetch(`${config.llmGatewayUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.defaultModel,
      temperature: 0,
      messages: [
        { role: "system", content: USER_MEMORY_EXTRACT_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(EXTRACT_GATEWAY_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`extract_gateway_${response.status}`);
  }
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? "";
}

export async function extractUserMemories(input: {
  userId: string;
  runId?: string;
  messages: Array<{ role?: string; text?: string }>;
  limit?: number;
}): Promise<MemoryItem[]> {
  if (!readMem0Info().configured) {
    return [];
  }
  const settings = await getUserMemorySettings(input.userId);
  if (!settings.enabled) {
    return [];
  }
  const transcript = formatTranscriptForExtract(input.messages);
  if (!transcript.trim()) {
    return [];
  }
  const raw = await extractComplete(transcript);
  const existing = new Set(
    (await listUserMemories(input.userId).catch(() => [])).map((item) => item.text.trim()),
  );
  const accepted = parseExtractedMemories(raw).filter((item) => !existing.has(item.text));
  const limit = input.limit ?? EXTRACT_SAVE_LIMIT;
  const saved: MemoryItem[] = [];
  for (const item of accepted.slice(0, limit)) {
    try {
      const added = await addUserMemory(input.userId, item.text, {
        source: "agent",
        kind: item.kind,
        status: "candidate",
        runId: input.runId,
      });
      if (added[0]) {
        saved.push(added[0]);
        existing.add(item.text);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "add_failed";
      console.warn(`memory extract add failed user=${input.userId} ${message}`);
    }
  }
  return saved;
}

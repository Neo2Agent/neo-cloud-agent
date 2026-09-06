import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  mintRunToken,
  parseExtractedMemories,
  type MemoryItem,
} from "@neo-cloud-agent/contracts";
import { getUserMemorySettings } from "../accounts/accounts.js";
import { getConfig } from "../config.js";
import { snapshotForRun } from "../events/snapshot.js";
import { controlStateDir } from "../store/persist.js";
import { readMem0Info } from "./client.js";
import { addUserMemory, listUserMemories } from "./service.js";

export const USER_MEMORY_EXTRACT_PROMPT = [
  "Extract only cross-project user coding tendencies from this conversation.",
  "Return a JSON array of {\"text\",\"kind\"} objects. kind must be style, habit, or coding.",
  "style = coding style tendencies. habit = collaboration rhythm. coding = toolchain facts that stay true in another repo.",
  "Write fuzzy one-liners using 倾向 / 通常. Never write 必须 / 从不 / 永远 / 讨厌.",
  "Do not extract family, health, mood, relationships, project names, module nicknames, architecture decisions, or idle-slot / repo-specific facts.",
  "If unsure, return []. Current task must remain able to override every item.",
].join(" ");

type ExtractedMap = Record<string, string>;

function extractedFile(): string {
  return path.join(controlStateDir(), "memory-extracted.json");
}

function readExtracted(): ExtractedMap {
  try {
    const parsed = JSON.parse(readFileSync(extractedFile(), "utf8")) as ExtractedMap;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeExtracted(map: ExtractedMap): void {
  const file = extractedFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(map)}\n`);
  renameSync(tmp, file);
}

export function wasRunExtracted(runId: string): boolean {
  return Boolean(readExtracted()[runId]);
}

export function markRunExtracted(runId: string): void {
  writeExtracted({ ...readExtracted(), [runId]: new Date().toISOString() });
}

export function formatTranscriptForExtract(messages: Array<{ role?: string; text?: string }>): string {
  return messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.text?.trim())
    .slice(-24)
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${(message.text ?? "").trim().slice(0, 800)}`)
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
    signal: AbortSignal.timeout(20_000),
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
  let raw = "";
  try {
    raw = await extractComplete(transcript);
  } catch (error) {
    const message = error instanceof Error ? error.message : "extract_failed";
    console.warn(`memory extract skipped user=${input.userId} ${message}`);
    return [];
  }
  const existing = new Set(
    (await listUserMemories(input.userId).catch(() => [])).map((item) => item.text.trim()),
  );
  const accepted = parseExtractedMemories(raw).filter((item) => !existing.has(item.text));
  const limit = input.limit ?? 8;
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
  if (input.runId) {
    markRunExtracted(input.runId);
  }
  return saved;
}

export async function extractIdleRun(run: { id: string; userId?: string | null }): Promise<MemoryItem[]> {
  if (!run.userId || wasRunExtracted(run.id)) {
    return [];
  }
  const snapshot = snapshotForRun(run.id);
  return extractUserMemories({
    userId: run.userId,
    runId: run.id,
    messages: snapshot.messages,
  });
}

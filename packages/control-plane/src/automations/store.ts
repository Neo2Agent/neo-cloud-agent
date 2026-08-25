import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  nextAutomationRunAt,
  parseAutomationSchedule,
  type Automation,
  type AutomationSchedule,
  type CreateAutomationRequest,
} from "@neo-cloud-agent/contracts";
import { controlStateDir } from "../store/persist.js";
import { automationPersistHooks } from "./persist-hooks.js";

const MAX_AUTOMATIONS = 20;

export function automationsFile(): string {
  return path.join(controlStateDir(), "automations.json");
}

let automationMemo: { file: string; items: Automation[] } | null = null;

function readAll(): Automation[] {
  const file = automationsFile();
  if (automationMemo?.file === file) {
    return automationMemo.items;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { automations?: unknown };
    const items = Array.isArray(parsed.automations) ? parsed.automations.map(normalize).filter(Boolean) as Automation[] : [];
    automationMemo = { file, items };
    return items;
  } catch {
    automationMemo = { file, items: [] };
    return automationMemo.items;
  }
}

function writeAll(items: Automation[], options?: { mirror?: boolean }): void {
  const file = automationsFile();
  automationMemo = { file, items };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 1, automations: items }, null, 2)}\n`, { mode: 0o600 });
  if (options?.mirror !== false) {
    automationPersistHooks().onWrite?.(items);
  }
}

export function replaceAutomations(items: Automation[], options?: { mirror?: boolean }): void {
  writeAll(items.map((item) => normalize(item)).filter((item): item is Automation => Boolean(item)), options);
}

function normalize(value: unknown): Automation | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record || typeof record.id !== "string" || typeof record.prompt !== "string") {
    return null;
  }
  let schedule: AutomationSchedule;
  try {
    schedule = parseAutomationSchedule(record.schedule);
  } catch {
    return null;
  }
  const repos = Array.isArray(record.repoUrls) ? record.repoUrls.filter((item): item is string => typeof item === "string") : [];
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
  return {
    id: record.id,
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : record.prompt.slice(0, 24),
    enabled: record.enabled !== false,
    prompt: record.prompt,
    repoUrls: repos,
    schedule,
    userId: typeof record.userId === "string" ? record.userId : "",
    orgId: typeof record.orgId === "string" ? record.orgId : "",
    nextRunAt: typeof record.nextRunAt === "string" ? record.nextRunAt : nextAutomationRunAt(schedule).toISOString(),
    lastRunAt: typeof record.lastRunAt === "string" ? record.lastRunAt : null,
    lastRunId: typeof record.lastRunId === "string" ? record.lastRunId : null,
    lastError: typeof record.lastError === "string" ? record.lastError : null,
    createdAt,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : createdAt,
  };
}

export function listAutomations(): Automation[] {
  return [...readAll()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function getAutomation(id: string): Automation | undefined {
  return readAll().find((item) => item.id === id);
}

export function createAutomation(
  input: CreateAutomationRequest,
  owner?: { userId?: string; orgId?: string },
): Automation {
  const items = readAll();
  if (items.length >= MAX_AUTOMATIONS) {
    throw new Error(`at most ${MAX_AUTOMATIONS} automations`);
  }
  const schedule = parseAutomationSchedule(input.schedule);
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("prompt required");
  const now = new Date();
  const item: Automation = {
    id: `auto_${randomUUID().slice(0, 8)}`,
    name: (input.name ?? "").trim() || prompt.slice(0, 24),
    enabled: input.enabled !== false,
    prompt,
    repoUrls: (input.repoUrls ?? []).map((item) => item.trim()).filter(Boolean),
    schedule,
    userId: owner?.userId?.trim() || "",
    orgId: owner?.orgId?.trim() || "",
    nextRunAt: nextAutomationRunAt(schedule, now).toISOString(),
    lastRunAt: null,
    lastRunId: null,
    lastError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  items.push(item);
  writeAll(items);
  return item;
}

export function updateAutomation(
  id: string,
  patch: Partial<Pick<Automation, "name" | "prompt" | "repoUrls" | "enabled" | "schedule" | "userId" | "orgId" | "lastRunAt" | "lastRunId" | "lastError" | "nextRunAt">>,
): Automation | null {
  const items = readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const current = items[index]!;
  const schedule = patch.schedule ? parseAutomationSchedule(patch.schedule) : current.schedule;
  const next: Automation = {
    ...current,
    name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
    prompt: patch.prompt !== undefined ? patch.prompt.trim() || current.prompt : current.prompt,
    repoUrls: patch.repoUrls ?? current.repoUrls,
    enabled: patch.enabled ?? current.enabled,
    userId: patch.userId !== undefined ? patch.userId : current.userId,
    orgId: patch.orgId !== undefined ? patch.orgId : current.orgId,
    schedule,
    nextRunAt: patch.nextRunAt ?? (patch.schedule ? nextAutomationRunAt(schedule).toISOString() : current.nextRunAt),
    lastRunAt: patch.lastRunAt !== undefined ? patch.lastRunAt : current.lastRunAt,
    lastRunId: patch.lastRunId !== undefined ? patch.lastRunId : current.lastRunId,
    lastError: patch.lastError !== undefined ? patch.lastError : current.lastError,
    updatedAt: new Date().toISOString(),
  };
  items[index] = next;
  writeAll(items);
  return next;
}

export function deleteAutomation(id: string): boolean {
  const items = readAll();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  writeAll(next);
  return true;
}

export function dueAutomations(at = new Date()): Automation[] {
  const iso = at.toISOString();
  return readAll().filter((item) => item.enabled && item.nextRunAt <= iso);
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CreateDeviceRequest, Device, DevicePlatform } from "@neo-cloud-agent/contracts";
import { parseDevicePlatform } from "@neo-cloud-agent/contracts";
import { controlStateDir } from "../store/persist.js";
import { devicePersistHooks } from "./persist-hooks.js";

const MAX_DEVICES = 20;

export type StoredDevice = Device & { pushToken: string };

export function devicesFile(): string {
  return path.join(controlStateDir(), "devices.json");
}

function now(): string {
  return new Date().toISOString();
}

export function publicDevice(item: StoredDevice): Device {
  const { pushToken: _token, ...rest } = item;
  return rest;
}

function normalize(value: unknown): StoredDevice | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record || typeof record.id !== "string" || typeof record.userId !== "string") {
    return null;
  }
  const platform = parseDevicePlatform(record.platform);
  const pushToken = typeof record.pushToken === "string" ? record.pushToken.trim() : "";
  if (!platform || !pushToken) {
    return null;
  }
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : now();
  return {
    id: record.id,
    userId: record.userId,
    orgId: typeof record.orgId === "string" ? record.orgId : "org_local",
    platform,
    pushToken,
    createdAt,
    lastSeenAt: typeof record.lastSeenAt === "string" ? record.lastSeenAt : createdAt,
  };
}

function readAll(): StoredDevice[] {
  try {
    const parsed = JSON.parse(readFileSync(devicesFile(), "utf8")) as { devices?: unknown };
    return Array.isArray(parsed.devices)
      ? parsed.devices.map(normalize).filter((item): item is StoredDevice => Boolean(item))
      : [];
  } catch {
    return [];
  }
}

function writeAll(items: StoredDevice[], options?: { mirror?: boolean }): void {
  mkdirSync(path.dirname(devicesFile()), { recursive: true });
  writeFileSync(devicesFile(), `${JSON.stringify({ version: 1, devices: items }, null, 2)}\n`, { mode: 0o600 });
  if (options?.mirror !== false) {
    devicePersistHooks().onWrite?.(items);
  }
}

export function replaceDevices(items: Device[], options?: { mirror?: boolean }): void {
  const current = new Map(readAll().map((item) => [item.id, item]));
  writeAll(
    items
      .map((item) => normalize({ ...current.get(item.id), ...item }))
      .filter((item): item is StoredDevice => Boolean(item)),
    options,
  );
}

export function listDevices(userId?: string): Device[] {
  return readAll()
    .filter((item) => !userId || item.userId === userId)
    .map(publicDevice);
}

export function listStoredDevices(userId?: string): StoredDevice[] {
  return readAll().filter((item) => !userId || item.userId === userId);
}

export function upsertDevice(
  input: CreateDeviceRequest,
  owner: { userId: string; orgId: string },
): Device {
  const platform = parseDevicePlatform(input.platform);
  const pushToken = input.pushToken.trim();
  if (!platform) {
    throw new Error("platform must be ios or android");
  }
  if (!pushToken) {
    throw new Error("pushToken is required");
  }
  const items = readAll();
  const existing = items.find((item) => item.userId === owner.userId && item.pushToken === pushToken);
  const seenAt = now();
  if (existing) {
    existing.platform = platform;
    existing.lastSeenAt = seenAt;
    writeAll(items);
    return publicDevice(existing);
  }
  if (items.filter((item) => item.userId === owner.userId).length >= MAX_DEVICES) {
    throw new Error(`at most ${MAX_DEVICES} devices`);
  }
  const stored: StoredDevice = {
    id: `dev_${crypto.randomUUID()}`,
    userId: owner.userId,
    orgId: owner.orgId,
    platform,
    pushToken,
    createdAt: seenAt,
    lastSeenAt: seenAt,
  };
  items.push(stored);
  writeAll(items);
  return publicDevice(stored);
}

export function deleteDevice(id: string, userId?: string): boolean {
  const items = readAll();
  const next = items.filter((item) => item.id !== id || (userId && item.userId !== userId));
  if (next.length === items.length) {
    return false;
  }
  writeAll(next);
  return true;
}

export function isExpoPushToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

export function resetDevicesForTests(): void {
  writeAll([], { mirror: false });
}

export type { DevicePlatform };

import type { ImageRef } from "@neo-cloud-agent/contracts";

export type PendingIngress = {
  kind: "image" | "file";
  label: string;
  image?: ImageRef;
  createdAt: number;
};

const pending = new Map<string, PendingIngress>();
const TTL_MS = 30 * 60 * 1000;

export function pendingKey(channel: "telegram" | "wechat", id: string): string {
  return `${channel}:${id}`;
}

export function rememberPendingIngress(key: string, item: Omit<PendingIngress, "createdAt">): void {
  pending.set(key, { ...item, createdAt: Date.now() });
}

export function takePendingIngress(key: string): PendingIngress | null {
  sweep();
  const item = pending.get(key) ?? null;
  if (item) pending.delete(key);
  return item;
}

export function peekPendingIngress(key: string): PendingIngress | null {
  sweep();
  return pending.get(key) ?? null;
}

export function resetPendingIngressForTests(): void {
  pending.clear();
}

function sweep(): void {
  const now = Date.now();
  for (const [key, item] of pending) {
    if (now - item.createdAt > TTL_MS) pending.delete(key);
  }
}

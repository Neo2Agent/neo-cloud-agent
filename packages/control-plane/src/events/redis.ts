import type { RunEvent } from "@neo-cloud-agent/contracts";

export type RedisHotClient = {
  publish(channel: string, message: string): Promise<void>;
  pSubscribe(pattern: string, onMessage: (message: string, channel: string) => void): Promise<() => Promise<void>>;
  xAdd(key: string, payload: string): Promise<void>;
  xRange(key: string): Promise<string[]>;
};

export function runChannel(runId: string): string {
  return `neo:run:${runId}`;
}

export function runStreamKey(runId: string): string {
  return `neo:run:${runId}:stream`;
}

export function createMemoryRedis(): RedisHotClient {
  const streams = new Map<string, string[]>();
  const patterns: Array<{ pattern: RegExp; fn: (message: string, channel: string) => void }> = [];

  return {
    async publish(channel, message) {
      for (const item of patterns) {
        if (item.pattern.test(channel)) {
          item.fn(message, channel);
        }
      }
    },
    async pSubscribe(pattern, onMessage) {
      const regex = new RegExp(`^${pattern.replaceAll("*", ".*")}$`);
      const entry = { pattern: regex, fn: onMessage };
      patterns.push(entry);
      return async () => {
        const index = patterns.indexOf(entry);
        if (index >= 0) {
          patterns.splice(index, 1);
        }
      };
    },
    async xAdd(key, payload) {
      const list = streams.get(key) ?? [];
      list.push(payload);
      streams.set(key, list.slice(-5000));
    },
    async xRange(key) {
      return streams.get(key) ?? [];
    },
  };
}

export async function connectRedis(url: string): Promise<RedisHotClient> {
  const redis = await import("redis");
  const client = redis.createClient({ url });
  const subscriber = client.duplicate();
  await client.connect();
  await subscriber.connect();
  return {
    async publish(channel, message) {
      await client.publish(channel, message);
    },
    async pSubscribe(pattern, onMessage) {
      await subscriber.pSubscribe(pattern, (message, channel) => {
        onMessage(message, channel);
      });
      return async () => {
        await subscriber.pUnsubscribe(pattern);
      };
    },
    async xAdd(key, payload) {
      await client.xAdd(key, "*", { event: payload }, {
        TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: 5000 },
      });
    },
    async xRange(key) {
      const entries = await client.xRange(key, "-", "+");
      return entries
        .map((item) => item.message.event)
        .filter((item): item is string => typeof item === "string");
    },
  };
}

export function parseHotEvent(raw: string): RunEvent | null {
  try {
    const event = JSON.parse(raw) as RunEvent;
    return event?.id && event.runId ? event : null;
  } catch {
    return null;
  }
}

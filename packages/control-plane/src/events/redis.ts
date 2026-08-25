import type { RunEvent } from "@neo-cloud-agent/contracts";

export type RedisHotClient = {
  publish(channel: string, message: string): Promise<void>;
  pSubscribe(pattern: string, onMessage: (message: string, channel: string) => void): Promise<() => Promise<void>>;
  xAdd(key: string, payload: string): Promise<void>;
  xRange(key: string): Promise<string[]>;
  incrWithTtl(key: string, ttlMs: number): Promise<number>;
  get(key: string): Promise<string | null>;
};

export function runChannel(runId: string): string {
  return `neo:run:${runId}`;
}

export function runStreamKey(runId: string): string {
  return `neo:run:${runId}:stream`;
}

export function createMemoryRedis(): RedisHotClient {
  const streams = new Map<string, string[]>();
  const counters = new Map<string, { value: number; expireAt: number }>();
  const patterns: Array<{ pattern: RegExp; fn: (message: string, channel: string) => void }> = [];

  function liveCounter(key: string): { value: number; expireAt: number } | undefined {
    const row = counters.get(key);
    if (!row || row.expireAt <= Date.now()) {
      counters.delete(key);
      return undefined;
    }
    return row;
  }

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
    async incrWithTtl(key, ttlMs) {
      const existing = liveCounter(key);
      if (!existing) {
        counters.set(key, { value: 1, expireAt: Date.now() + Math.max(1, ttlMs) });
        return 1;
      }
      existing.value += 1;
      return existing.value;
    },
    async get(key) {
      const existing = liveCounter(key);
      return existing ? String(existing.value) : null;
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
    async incrWithTtl(key, ttlMs) {
      const count = await client.incr(key);
      if (count === 1) {
        await client.pExpire(key, Math.max(1, ttlMs));
      }
      return count;
    },
    async get(key) {
      return client.get(key);
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

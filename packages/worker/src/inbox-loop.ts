import type { WorkerInbound } from "@neo-cloud-agent/contracts";

export type InboxDispatchResult = "continue" | "stop";

export function isUserTurn(message: WorkerInbound): boolean {
  return message.type === "prompt" || message.type === "steer" || message.type === "follow_up";
}

export function isInterrupt(message: WorkerInbound): boolean {
  return message.type === "abort" || message.type === "shutdown";
}

export type InboxLoop = {
  pull: () => Promise<WorkerInbound[]>;
  dispatch: (message: WorkerInbound) => Promise<InboxDispatchResult>;
  afterUserTurn?: (message: WorkerInbound) => Promise<void>;
  isStreaming: () => boolean;
  pollMs: number;
  exitAfterTurn?: boolean;
  sleep?: (ms: number) => Promise<void>;
  shouldStop?: () => boolean;
  onPullError?: (error: unknown, consecutiveFailures: number) => Promise<"retry" | "throw">;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pull the control-plane inbox even while `session.prompt()` is in flight.
 *
 * Abort used to sit in the queue until the current turn finished, so the
 * composer stop button looked dead. Interrupts and mid-stream steer/follow-up
 * must run against the live session, not after it.
 */
export async function runInboxLoop(loop: InboxLoop): Promise<void> {
  const sleep = loop.sleep ?? defaultSleep;
  let running = true;
  let servedTurn = false;
  const pending: { task: Promise<InboxDispatchResult> | null } = { task: null };
  let consecutiveFailures = 0;

  const alive = () => running && !loop.shouldStop?.();

  async function handle(message: WorkerInbound, finishTurn = isUserTurn(message)): Promise<InboxDispatchResult> {
    if (isUserTurn(message)) {
      servedTurn = true;
    }
    const next = await loop.dispatch(message);
    if (finishTurn) {
      await loop.afterUserTurn?.(message);
    }
    return next;
  }

  async function startTurn(message: WorkerInbound): Promise<void> {
    const task = handle(message);
    pending.task = task;
    void task
      .then((next) => {
        if (next === "stop") {
          running = false;
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (pending.task === task) {
          pending.task = null;
        }
      });
  }

  async function waitUntilStreamingOrSettled(): Promise<void> {
    while (pending.task && !loop.isStreaming() && alive()) {
      await Promise.race([pending.task, sleep(10)]);
    }
  }

  async function applyInterrupt(message: WorkerInbound): Promise<InboxDispatchResult> {
    if (pending.task && !loop.isStreaming()) {
      await waitUntilStreamingOrSettled();
    }
    return handle(message);
  }

  async function handleBatch(messages: WorkerInbound[]): Promise<void> {
    let skipRemainingTurns = false;
    for (const message of messages) {
      if (!alive()) {
        running = false;
        return;
      }
      if (isInterrupt(message)) {
        const hadTurn = Boolean(pending.task);
        const next = await applyInterrupt(message);
        if (!hadTurn) {
          skipRemainingTurns = true;
          servedTurn = true;
          await loop.afterUserTurn?.(message);
        }
        if (next === "stop") {
          running = false;
          return;
        }
        continue;
      }
      if (isUserTurn(message)) {
        if (skipRemainingTurns) {
          continue;
        }
        if (!pending.task) {
          await startTurn(message);
          continue;
        }
        const next = await handle(message, false);
        if (next === "stop") {
          running = false;
          return;
        }
        continue;
      }
      const next = await handle(message, false);
      if (next === "stop") {
        running = false;
        return;
      }
    }
  }

  try {
    while (alive()) {
      let messages: WorkerInbound[] = [];
      try {
        messages = await loop.pull();
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        const action = (await loop.onPullError?.(error, consecutiveFailures)) ?? "retry";
        if (action === "throw") {
          throw error;
        }
        await sleep(loop.pollMs);
        continue;
      }

      await handleBatch(messages);

      if (
        alive() &&
        loop.exitAfterTurn &&
        servedTurn &&
        messages.length === 0 &&
        !loop.isStreaming() &&
        !pending.task
      ) {
        break;
      }
      if (!alive()) {
        break;
      }
      if (pending.task) {
        await Promise.race([pending.task, sleep(loop.pollMs)]);
      } else {
        await sleep(loop.pollMs);
      }
    }
  } finally {
    await pending.task?.catch(() => undefined);
  }
}

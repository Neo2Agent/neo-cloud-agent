import { preferSpokenText, type StartVoiceResult, type VoiceSession } from "./voice";
export type { StartVoiceResult, VoiceSession };

export function describeSpeechError(message: string): string {
  if (/rate_limited/i.test(message)) return "听写请求太密，请稍后再试。";
  return message || "听写服务不可用";
}

export type SpeechIatPush = (body: {
  sessionId?: string;
  audio?: string;
  status: 0 | 1 | 2;
}) => Promise<{ sessionId: string; text: string; done?: boolean; error?: string }>;

export type PcmCapture = {
  start: (onFrame: (pcm: Uint8Array) => void) => Promise<void>;
  stop: () => Promise<void>;
};

/** ~400ms of 16 kHz s16le. Native still captures 40ms; HTTP this often, not every mic read. */
export const IAT_HTTP_MIN_BYTES = 12_800;

export type CloudVoiceOptions = {
  minHttpBytes?: number;
};

export function pcmToBase64(pcm: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < pcm.length; i += 1) {
    binary += String.fromCharCode(pcm[i] ?? 0);
  }
  return btoa(binary);
}

export function concatPcm(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function startCloudVoice(
  push: SpeechIatPush,
  capture: PcmCapture,
  onPreview: (text: string) => void,
  onError?: (message: string) => void,
  onEnded?: () => void,
  options?: CloudVoiceOptions,
): Promise<StartVoiceResult> {
  const minHttpBytes = options?.minHttpBytes ?? IAT_HTTP_MIN_BYTES;
  let sessionId = "";
  let nextStatus: 0 | 1 | 2 = 0;
  let lastText = "";
  let chain = Promise.resolve();
  let opening: Promise<void> | null = null;
  let stopped = false;
  let failed = false;
  let ended = false;
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;

  const enqueue = (job: () => Promise<void>) => {
    chain = chain.then(job, job);
    return chain;
  };

  const finish = () => {
    if (ended) return;
    ended = true;
    onEnded?.();
  };

  const fail = (message: string) => {
    if (failed) return;
    failed = true;
    stopped = true;
    void capture.stop().catch(() => undefined);
    onError?.(describeSpeechError(message));
  };

  const runPush = async (status: 0 | 1 | 2, audio?: string) => {
    if ((failed || (stopped && !audio)) && status !== 2) return;
    const reply = await push({ sessionId: sessionId || undefined, audio, status });
    if (reply.error) throw new Error(reply.error);
    sessionId = reply.sessionId || sessionId;
    if (reply.text) {
      lastText = preferSpokenText(lastText, reply.text);
      onPreview(lastText);
    }
    if (reply.done && status !== 2) {
      stopped = true;
      void capture.stop().catch(() => undefined);
      finish();
    }
    if (status !== 2) nextStatus = 1;
  };

  const send = (status: 0 | 1 | 2, audio?: string) => {
    const job = () => runPush(status, audio);
    if (status === 0 || status === 2 || !sessionId) return enqueue(job);
    return job();
  };

  const takePending = (): string => {
    if (!pendingBytes) return "";
    const audio = pcmToBase64(concatPcm(pending));
    pending = [];
    pendingBytes = 0;
    return audio;
  };

  const flush = (status: 0 | 1 | 2, audio = takePending()) =>
    send(status, audio).catch((error) => {
      fail(error instanceof Error ? error.message : "听写服务不可用");
    });

  try {
    await capture.start((pcm) => {
      if (!pcm.length || stopped) return;
      pending.push(pcm);
      pendingBytes += pcm.length;
      if (pendingBytes < minHttpBytes) return;
      if (!sessionId && opening) return;
      const pendingOpen = !sessionId;
      const task = flush(nextStatus);
      if (pendingOpen) opening = task.finally(() => {
        opening = null;
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "请允许麦克风后再试。";
    return { kind: "error", message: /permission|麦克风|denied/i.test(message) ? "请允许麦克风后再试。" : describeSpeechError(message) };
  }

  const session: VoiceSession = {
    stop: async () => {
      stopped = true;
      try {
        await capture.stop();
      } catch {
        /* ignore */
      }
      const leftover = takePending();
      if (leftover) {
        try {
          await send(nextStatus, leftover);
        } catch {
          /* ignore */
        }
      }
      try {
        await send(2);
      } catch {
        /* ignore */
      }
      finish();
      return lastText.replace(/\s+/g, " ").trim();
    },
  };
  return { kind: "session", session };
}

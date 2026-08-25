export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type ExpoPushKind = "idle" | "error" | "pr";

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: {
    runId: string;
    kind: ExpoPushKind;
    url: string;
  };
  sound: "default";
};

export function formatExpoPushMessage(input: {
  token: string;
  title: string;
  body: string;
  runId: string;
  kind: ExpoPushKind;
  url: string;
}): ExpoPushMessage {
  return {
    to: input.token,
    title: input.title,
    body: input.body,
    data: { runId: input.runId, kind: input.kind, url: input.url },
    sound: "default",
  };
}

export function chunkExpoMessages<T>(items: T[], size = 100): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function sendExpoPush(
  messages: ExpoPushMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  if (messages.length === 0) {
    return 0;
  }
  let sent = 0;
  for (const chunk of chunkExpoMessages(messages)) {
    const response = await fetchImpl(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) {
      throw new Error(`expo ${response.status}`);
    }
    sent += chunk.length;
  }
  return sent;
}

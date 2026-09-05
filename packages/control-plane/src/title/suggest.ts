import { runIndexTitle } from "../store/run-record.js";

const SUGGEST_TIMEOUT_MS = 15_000;
const PROMPT_SLICE = 500;
const MAX_TOKENS = 64;
const MOCK_MARKER = "Mock gateway";

const SYSTEM_PROMPT =
  "你是任务标题助手。根据用户的第一条指令，写一个不超过 20 个汉字或 12 个英文单词的侧边栏标题。只输出标题本身，不要引号、不要解释。";

export class TitleSuggestError extends Error {
  constructor(message = "title_generate_failed") {
    super(message);
    this.name = "TitleSuggestError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let titleFetch: FetchLike = globalThis.fetch;

export function setSuggestFetchForTests(fn: FetchLike | null): void {
  titleFetch = fn ?? globalThis.fetch;
}

export type SuggestRunTitleInput = {
  prompt: string;
  model: string;
  jwt: string;
  gatewayUrl: string;
};

function promptSlice(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim().slice(0, PROMPT_SLICE);
}

function fallbackTitle(prompt: string): string {
  return runIndexTitle({ prompt });
}

function parseSuggestedTitle(content: unknown, prompt: string): string {
  if (typeof content !== "string") {
    return fallbackTitle(prompt);
  }
  const line = content.split(/\r?\n/, 1)[0] ?? "";
  if (!line.trim() || line.includes(MOCK_MARKER)) {
    return fallbackTitle(prompt);
  }
  const cleaned = line.replace(/^["「『]+|["」』]+$/g, "").trim();
  const title = runIndexTitle({ title: cleaned });
  return title;
}

export async function suggestRunTitle(input: SuggestRunTitleInput): Promise<string> {
  const text = promptSlice(input.prompt);
  const url = `${input.gatewayUrl.replace(/\/$/, "")}/v1/chat/completions`;
  let response: Response;
  try {
    response = await titleFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.jwt}`,
      },
      body: JSON.stringify({
        model: input.model,
        stream: false,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text || "未命名任务" },
        ],
      }),
      signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new TitleSuggestError(aborted ? "title_generate_timeout" : "title_generate_failed");
  }
  if (!response.ok) {
    throw new TitleSuggestError();
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TitleSuggestError();
  }
  const choices = payload && typeof payload === "object" ? (payload as { choices?: unknown }).choices : null;
  const first = Array.isArray(choices) ? choices[0] : null;
  const message = first && typeof first === "object" ? (first as { message?: { content?: unknown } }).message : null;
  return parseSuggestedTitle(message?.content, input.prompt);
}

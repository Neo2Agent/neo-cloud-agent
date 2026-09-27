export const MOCK_GATEWAY_TEXT =
  "Mock gateway response. Save a DeepSeek or OpenAI API key on the chat page, or set DEEPSEEK_API_KEY / OPENAI_API_KEY.";

export type TranscriptDump = {
  href: string;
  assistantTexts: string[];
  setupTexts: string[];
  userTexts: string[];
  bodyText: string;
};

export function countNeedle(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let from = 0;
  while (true) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) {
      return count;
    }
    count += 1;
    from = at + needle.length;
  }
}

/** Fail only on the glued-bubble bug. Two turns each with one mock is correct. */
export function assertUniqueMockReplies(dump: TranscriptDump, where: string): void {
  const doubled = dump.assistantTexts.filter((text) => countNeedle(text, MOCK_GATEWAY_TEXT) > 1);
  if (doubled.length > 0) {
    throw new Error(`${where}: one assistant bubble contains the mock twice. assistants=${JSON.stringify(dump.assistantTexts)}`);
  }
  const mockBubbles = dump.assistantTexts.filter((text) => text.includes("Mock gateway response"));
  if (mockBubbles.length === 0) {
    throw new Error(`${where}: no mock reply on the page. body=${dump.bodyText.slice(0, 400)}`);
  }
  if (dump.userTexts.length >= 2 && mockBubbles.length === 1 && countNeedle(dump.bodyText, MOCK_GATEWAY_TEXT) > 1) {
    throw new Error(`${where}: follow compacted two mock streams into one bubble. assistants=${JSON.stringify(dump.assistantTexts)}`);
  }
}

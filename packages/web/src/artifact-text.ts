/** Cap in-panel text so a huge log cannot freeze the chat page. */
export const ARTIFACT_TEXT_PREVIEW_BYTES = 200_000;

export function decodeUtf8Preview(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

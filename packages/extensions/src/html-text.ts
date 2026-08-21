const MAX_INPUT = 200_000;
const MAX_OUTPUT = 8_000;

export function extractPageText(html: string, url: string): { title: string; text: string } {
  const clipped = html.length > MAX_INPUT ? html.slice(0, MAX_INPUT) : html;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(clipped);
  const title = decodeEntities((titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim()) || url;
  const withoutNoise = clipped
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(withoutNoise)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  const body = text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n…` : text;
  return { title, text: body || "(no text)" };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : "";
    });
}

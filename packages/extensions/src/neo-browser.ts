import { asString, callControlPlane } from "./client.js";
import { extractPageText } from "./html-text.js";
import { defineExtension, type CloudToolContext, type CloudToolDefinition, type CloudToolResult } from "./types.js";

export const neoBrowser = defineExtension({
  name: "neo-browser",
  description: "Fetch an http(s) page as title plus text. Not a headed browser; egress still applies.",
});

export async function executeBrowse(
  ctx: CloudToolContext,
  params: Record<string, unknown>,
): Promise<CloudToolResult> {
  const raw = asString(params.url).trim();
  if (!raw) {
    return { content: "url is required.", isError: true };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { content: "invalid url.", isError: true };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { content: "only http(s) urls are allowed.", isError: true };
  }
  try {
    const decision = await callControlPlane<{ allow?: boolean; reason?: string }>(
      ctx,
      `/internal/runs/${encodeURIComponent(ctx.runId)}/egress-check`,
      { method: "POST", body: JSON.stringify({ url: url.href }) },
    );
    if (decision.allow === false) {
      return { content: decision.reason || "egress denied", isError: true };
    }
  } catch {
    // Worker fetch is already egress-guarded; continue when the check endpoint is unavailable.
  }
  try {
    const fetchFn = ctx.fetch ?? globalThis.fetch;
    const response = await fetchFn(url.href, {
      redirect: "follow",
      headers: { accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1" },
    });
    const body = await response.text();
    const page = extractPageText(body, url.href);
    return {
      content: `# ${page.title}\n${url.href}\nHTTP ${response.status}\n\n${page.text}`,
      details: { url: url.href, status: response.status, title: page.title },
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "browse failed",
      isError: true,
    };
  }
}

export function createBrowserTool(ctx: CloudToolContext): CloudToolDefinition {
  return {
    name: "neo_browse",
    label: "Neo Browse",
    description:
      "Fetch a public http(s) URL and return the title plus visible text. Use this instead of curl for documentation pages. Egress policy still applies. This is not a headed browser.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: { type: "string", description: "http or https URL" },
      },
    },
    execute: (params) => executeBrowse(ctx, params),
  };
}

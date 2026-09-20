import {
  decorateCatalogIds,
  publicLlmSettings,
  readLlmSettings,
  staticChatCatalog,
  type ChatModelOption,
  type LlmModelsSource,
  type LlmSettings,
  type PublicLlmSettings,
} from "@neo-cloud-agent/contracts";

const TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 1_500;

let cache: { at: number; models: ChatModelOption[] } | null = null;

export function resetLlmCatalogCache(): void {
  cache = null;
}

function catalogBaseUrl(settings: LlmSettings | null): string {
  return (settings?.baseUrl ?? "").replace(/\/$/, "");
}

function parseModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map((item) => {
    if (typeof item === "string") {
      return item;
    }
    if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
      return (item as { id: string }).id;
    }
    return "";
  });
}

export async function fetchUpstreamChatModels(baseUrl: string, apiKey: string): Promise<ChatModelOption[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`upstream models status=${response.status}`);
  }
  return decorateCatalogIds(parseModelIds(await response.json()));
}

export async function resolveLlmCatalog(
  settings: LlmSettings | null = readLlmSettings(),
): Promise<{ models: ChatModelOption[]; modelsSource: LlmModelsSource }> {
  const fallback = staticChatCatalog();
  const baseUrl = catalogBaseUrl(settings);
  const apiKey = settings?.apiKey ?? "";
  if (!apiKey || settings?.upstream === "mock" || !baseUrl) {
    return fallback;
  }
  if (cache && Date.now() - cache.at < TTL_MS) {
    return { models: cache.models, modelsSource: "newapi" };
  }
  try {
    const models = await fetchUpstreamChatModels(baseUrl, apiKey);
    if (models.length === 0) {
      return fallback;
    }
    cache = { at: Date.now(), models };
    return { models, modelsSource: "newapi" };
  } catch {
    return fallback;
  }
}

export async function publishedLlmSettings(
  settings: LlmSettings | null = readLlmSettings(),
): Promise<PublicLlmSettings> {
  const published = publicLlmSettings(settings);
  const catalog = await resolveLlmCatalog(settings);
  return { ...published, ...catalog };
}

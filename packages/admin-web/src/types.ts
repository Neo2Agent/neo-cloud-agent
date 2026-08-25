export type AdminOverview = {
  users: { total: number; admins: number };
  runs: { total: number; live: number; byStatus?: Record<string, number> };
  tokens: { usedMonth: number };
  quota: { maxTokensMonth: number; usedTokensMonth: number };
  capacity: {
    backend: string;
    total: number;
    busy: number;
    slots: Array<{ id: string; status: string; runId: string | null; mounted: boolean }>;
  };
  rateLimit: { enabled: boolean; store: string };
  llm: { configured: boolean; upstream: string; model: string | null; baseUrl: string | null };
  newApi: { url: string | null; consoleUrl: string | null };
  platform: { metadataStore: string; eventBus: string; workerRuntime: string };
  counts: { automations: number; projects: number; builds: number; environments: number; desks: number };
};

export type AdminUser = {
  id: string;
  email: string;
  orgId: string;
  admin: boolean;
  runCount: number;
  usedTokensMonth: number;
  concurrentRuns: number;
  lastActiveAt: string | null;
};

export type AdminRun = {
  id: string;
  status: string;
  prompt: string;
  userId: string;
  orgId?: string;
  model: string;
  source?: string;
  createdAt?: string;
  updatedAt: string;
  usage?: { totalTokens?: number } | null;
};

export type RateLimitSnapshot = {
  enabled: boolean;
  store: string;
  policies: Record<string, { remaining: number; limit: number; windowMs: number; kind: string }>;
};

export type AdminPage = "overview" | "users" | "runs" | "system";

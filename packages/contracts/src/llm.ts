/** JWT minted by the control plane and the only credential a VM may hold. */
export interface LlmRunTokenClaims {
  iss: "neo-llm-gateway";
  sub: string;
  runId: string;
  orgId: string;
  model: string;
  exp: number;
  jti: string;
}

export interface ModelRoute {
  /** Stable id shown to users and stored on the Run. */
  publicId: string;
  /** pi-ai / OpenAI-compatible upstream. */
  provider: string;
  upstreamModel: string;
  baseUrl?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

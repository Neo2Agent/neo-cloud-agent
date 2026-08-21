export const config = {
  port: Number(process.env.LLM_GATEWAY_PORT ?? 8081),
  jwtSecret: process.env.LLM_GATEWAY_JWT_SECRET ?? "dev-only-change-me",
};

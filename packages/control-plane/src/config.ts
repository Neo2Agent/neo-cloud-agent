export const config = {
  port: Number(process.env.CONTROL_PLANE_PORT ?? 8080),
  orgId: process.env.DEFAULT_ORG_ID ?? "org_local",
  userId: process.env.DEFAULT_USER_ID ?? "user_local",
  workerImage: process.env.WORKER_IMAGE ?? "neo-cloud-agent/worker:dev",
  defaultModel: process.env.DEFAULT_MODEL ?? "neo/sonnet",
};

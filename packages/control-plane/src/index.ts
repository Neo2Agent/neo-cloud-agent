import { createApiServer } from "./api/server.js";
import { getConfig } from "./config.js";
import { startPlatform } from "./platform.js";
import { startScheduler } from "./scheduler/scheduler.js";
import { databaseKindFromUrl } from "./store/database.js";

const config = getConfig();
const scheduler = startScheduler();
const server = createApiServer();

void startPlatform()
  .catch((error) => {
    console.error("platform init failed", error);
  })
  .finally(() => {
    server.listen(config.port, () => {
      const extra = [
        `workerRuntime=${config.workerRuntime}`,
        process.env.DATABASE_URL ? databaseKindFromUrl(process.env.DATABASE_URL) : "fs",
        process.env.REDIS_URL ? "redis" : "memory",
      ].join(" ");
      console.log(`control-plane listening on :${config.port} ${extra}`);
    });
  });

const shutdown = () => {
  scheduler.stop();
  server.close();
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  setTimeout(() => process.exit(0), 4000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

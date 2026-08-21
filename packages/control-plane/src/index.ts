import { createApiServer } from "./api/server.js";
import { getConfig } from "./config.js";
import { startScheduler } from "./scheduler/scheduler.js";

const config = getConfig();
const scheduler = startScheduler();
const server = createApiServer();

server.listen(config.port, () => {
  console.log(`control-plane listening on :${config.port} workerRuntime=${config.workerRuntime}`);
});

const shutdown = () => {
  scheduler.stop();
  server.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

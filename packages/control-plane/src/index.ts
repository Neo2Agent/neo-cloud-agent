import { createApiServer } from "./api/server.js";
import { config } from "./config.js";
import { startScheduler } from "./scheduler/scheduler.js";

const scheduler = startScheduler();
const server = createApiServer();

server.listen(config.port, () => {
  console.log(`control-plane listening on :${config.port}`);
});

const shutdown = () => {
  scheduler.stop();
  server.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import { createAdminApiServer } from "./server.js";
import { startAdminData } from "./data.js";

const port = Number(process.env.ADMIN_API_PORT ?? 8090);
const host = process.env.ADMIN_API_HOST ?? "127.0.0.1";
const server = createAdminApiServer();

void startAdminData()
  .catch((error) => {
    console.error("admin-api init failed", error);
  })
  .finally(() => {
    server.listen(port, host, () => {
      console.log(`admin-api listening on ${host}:${port}`);
    });
  });

const shutdown = () => {
  server.close();
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  setTimeout(() => process.exit(0), 4000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

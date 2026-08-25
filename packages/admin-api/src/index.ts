import { createAdminApiServer } from "./server.js";
import { startAdminData } from "./data.js";

const port = Number(process.env.ADMIN_API_PORT ?? 8090);
const server = createAdminApiServer();

void startAdminData()
  .catch((error) => {
    console.error("admin-api init failed", error);
  })
  .finally(() => {
    server.listen(port, () => {
      console.log(`admin-api listening on :${port}`);
    });
  });

const shutdown = () => {
  server.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import { getConfig } from "./config.js";
import { createGatewayServer } from "./server.js";

const config = getConfig();
const server = createGatewayServer();

server.listen(config.port, () => {
  console.log(`llm-gateway listening on :${config.port} upstream=${config.upstream}`);
});

const shutdown = () => server.close();
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import { config } from "./config.js";
import { createGatewayServer } from "./server.js";

const server = createGatewayServer();

server.listen(config.port, () => {
  console.log(`llm-gateway listening on :${config.port}`);
});

const shutdown = () => server.close();
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

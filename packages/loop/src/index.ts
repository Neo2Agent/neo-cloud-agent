import { createLoopServer, listen } from "./server.js";

const port = Number(process.env.NEO_LOOP_PORT ?? 8082);
const host = process.env.NEO_LOOP_BIND ?? "127.0.0.1";
const server = createLoopServer();

const bound = await listen(server, port, host);
console.log(`neo-loop listening on ${host}:${bound} runtime=node`);

const shutdown = () => {
  void server.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

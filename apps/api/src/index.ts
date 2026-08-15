import { createApp } from "./app";
import { config } from "./config";

const app = createApp();

app.listen({ hostname: config.host, port: config.port });

console.log(`Hospital API listening on http://${config.host}:${config.port}`);

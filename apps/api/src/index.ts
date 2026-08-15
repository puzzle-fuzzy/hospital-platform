import { createLogger } from "@hospital/observability";
import { createApp } from "./app";
import { config } from "./config";

const logger = createLogger({
	service: "hospital-api",
	environment: config.environment,
	level: config.logLevel,
});
const app = createApp({ logger });

app.listen({ hostname: config.host, port: config.port });

logger.info(
	{
		event: "service.started",
		host: config.host,
		port: config.port,
	},
	"Hospital API listening",
);

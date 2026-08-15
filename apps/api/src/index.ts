import { createWechatIdentityGateway } from "@hospital/adapters";
import { createLogger } from "@hospital/observability";
import { createPersistenceRuntime } from "@hospital/persistence";
import { createApp } from "./app";
import { createDefaultApplicationServices } from "./application";
import { config } from "./config";
import { createReadinessService } from "./infrastructure/readiness";

const logger = createLogger({
	service: "hospital-api",
	environment: config.environment,
	level: config.logLevel,
});
const persistence = createPersistenceRuntime({
	databaseUrl: config.databaseUrl,
	redisUrl: config.redisUrl,
	useRepositories: config.persistenceSchemaReady,
});
const identityGateway = config.wechatIdentityReady
	? createWechatIdentityGateway({
			appId: config.wechatAppId ?? "",
			appSecret: config.wechatAppSecret ?? "",
			baseUrl: config.wechatIdentityBaseUrl,
		})
	: undefined;
const app = createApp({
	logger,
	services: createDefaultApplicationServices({
		...(persistence.repositories
			? { repositories: persistence.repositories }
			: {}),
		...(persistence.sessions ? { sessionStore: persistence.sessions } : {}),
		...(identityGateway ? { identityGateway } : {}),
	}),
	readiness: createReadinessService({
		databaseConfigured: Boolean(config.databaseUrl),
		redisConfigured: Boolean(config.redisUrl),
		databaseProbe: () => persistence.database.check(),
		redisProbe: () => persistence.redis.check(),
	}),
});

app.onStop(async () => {
	await persistence.close();
});

app.listen({ hostname: config.host, port: config.port });

logger.info(
	{
		event: "service.started",
		host: config.host,
		port: config.port,
	},
	"Hospital API listening",
);

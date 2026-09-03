import cors from "@elysiajs/cors";
import openapi from "@elysiajs/openapi";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import { DependencyNotConfiguredError } from "@hospital/domain";
import { Elysia } from "elysia";
import {
	type ApplicationServices,
	createDefaultApplicationServices,
} from "./application";
import { config } from "./config";
import {
	createReadinessService,
	type ReadinessService,
} from "./infrastructure/readiness";
import { appointmentsModule } from "./modules/appointments";
import type { AppointmentWriteService } from "./modules/appointments";
import { authModule } from "./modules/auth";
import { healthModule } from "./modules/health";
import { healthKnowledgeModule } from "./modules/knowledge";
import { medicalInsuranceModule } from "./modules/medical-insurance";
import type { MedicalInsuranceRegistrationService } from "./modules/medical-insurance";
import type { MedicalInsuranceNotificationService } from "./modules/medical-insurance/service";
import { myDoctorsModule } from "./modules/my-doctors";
import { outpatientPaymentsModule } from "./modules/outpatient-payments";
import { patientsModule } from "./modules/patients";
import { paymentsModule } from "./modules/payments";
import { profileModule } from "./modules/profile";
import { reportsModule } from "./modules/reports";
import { systemModule } from "./modules/system";
import { errorHandlerPlugin } from "./plugins/error-handler";
import { requestContextPlugin } from "./plugins/request-context";
import { requestLoggingPlugin } from "./plugins/request-logging";

export type AppOptions = {
	readiness?: ReadinessService;
	services?: ApplicationServices;
	/** 运行入口注入 Pino；测试默认使用 silent logger。 */
	logger?: AppLogger;
	/**
	 * 微信支付订单模块的显式运行闸门；默认关闭。
	 *
	 * 生产组合根只有在 `WECHAT_PAYMENT_READY`、完整商户配置、回调解密器和
	 * 真实验收条件同时满足后才传入 true。关闭时路由仍保留在 OpenAPI 中，
	 * 但所有支付入口在仓储/provider 之前返回 503，避免误删公共契约或产生副作用。
	 */
	wechatPaymentEnabled?: boolean;
	/**
	 * 医保结算通知模块；未传入 service 时不注册路由（组合根级 fail-closed）。
	 * 生产组合根只有在 MEDICAL_INSURANCE_READY 与完整密钥配置下才构造。
	 */
	medicalInsuranceNotification?: MedicalInsuranceNotificationService;
};

function openApiPlugin() {
	if (!config.docsEnabled) return new Elysia({ name: "openapi-disabled" });

	return openapi({
		documentation: {
			info: {
				title: "Hospital Platform API",
				version: config.apiVersion,
				description: "医院患者端与外部医疗系统的安全编排 API",
			},
			tags: [
				{ name: "health", description: "运行状态" },
				{ name: "system", description: "系统基础接口" },
				{ name: "auth", description: "患者端身份认证" },
				{ name: "profile", description: "普通个人资料" },
				{ name: "patients", description: "患者档案" },
				{ name: "appointments", description: "预约目录" },
				{ name: "medical-insurance", description: "医保授权与结算" },
				{ name: "my-doctors", description: "我的医生" },
				{ name: "knowledge", description: "审核后的健康百科只读内容" },
				{ name: "reports", description: "检查检验报告目录" },
				{ name: "payments", description: "支付订单" },
			],
		},
	});
}

export function createApp(options: AppOptions = {}) {
	const readiness =
		options.readiness ??
		createReadinessService({
			databaseConfigured: Boolean(config.databaseUrl),
			redisConfigured: Boolean(config.redisUrl),
			schemaReady: config.persistenceSchemaReady,
		});
	const services = options.services ?? createDefaultApplicationServices();
	const logger = options.logger ?? createNoopLogger();
	const appointmentWrites =
		services.appointmentWrites ??
		({
			hold: async () => {
				throw new DependencyNotConfiguredError("appointment-writes");
			},
			register: async () => {
				throw new DependencyNotConfiguredError("appointment-writes");
			},
			cancel: async () => {
				throw new DependencyNotConfiguredError("appointment-writes");
			},
		} as unknown as AppointmentWriteService);
	const medicalInsurance =
		services.medicalInsurance ??
		({
			authorize: async () => {
				throw new DependencyNotConfiguredError("medical-insurance");
			},
			uploadFees: async () => {
				throw new DependencyNotConfiguredError("medical-insurance");
			},
			settle: async () => {
				throw new DependencyNotConfiguredError("medical-insurance");
			},
			query: async () => {
				throw new DependencyNotConfiguredError("medical-insurance");
			},
		} as unknown as MedicalInsuranceRegistrationService);

	// 患者端公共 contract 采用 fail-closed 输入语义：未知字段不能被 Elysia
	// 默认 normalize 静默清洗，否则旧端的身份/支付字段可能被误认为已保存。
	// 各模块仍需通过 schema 明确声明 additionalProperties 边界。
	const app = new Elysia({ name: "hospital-api", normalize: false })
		.use(
			cors({
				origin:
					config.corsOrigins.length === 1 && config.corsOrigins[0] === "*"
						? true
						: config.corsOrigins,
			}),
		)
		.use(requestContextPlugin())
		// 先捕获错误生命周期的低敏元数据，再由统一错误处理器映射最终响应。
		.use(requestLoggingPlugin(logger))
		// afterResponse 仍会读取错误处理器最终写入的状态码，保持日志与响应一致。
		.use(errorHandlerPlugin())
		.use(openApiPlugin())
		.use(healthModule(readiness))
		.group("/api/v1", (api) =>
			api
				.use(systemModule())
				.use(authModule(services.auth, services.sessions))
				.use(
					services.healthKnowledge
						? healthKnowledgeModule(services.healthKnowledge, services.sessions)
						: new Elysia({ name: "health-knowledge-not-configured" }),
				)
				.use(
					services.profile
						? profileModule(services.profile, services.sessions)
						: new Elysia({ name: "profile-not-configured" }),
				)
				.use(patientsModule(services.patients, services.sessions))
				.use(
					appointmentsModule(
						services.appointments,
						appointmentWrites,
						services.sessions,
					),
				)
				.use(
					services.myDoctors
						? myDoctorsModule(services.myDoctors, services.sessions)
						: new Elysia({ name: "my-doctors-not-configured" }),
				)
				.use(reportsModule(services.reports, services.sessions))
				.use(
					services.outpatientPayments
						? outpatientPaymentsModule(
								services.outpatientPayments,
								services.sessions,
							)
						: new Elysia({ name: "outpatient-payments-not-configured" }),
				)
				.use(
					paymentsModule(
						services.paymentOrders,
						services.wechatPrepay,
						services.wechatPaymentNotifications,
						services.sessions,
						options.wechatPaymentEnabled === true,
					),
				)
				.use(
					medicalInsuranceModule(
						medicalInsurance,
						services.sessions,
						options.medicalInsuranceNotification,
					),
				),
		);

	return app;
}

export type HospitalApp = ReturnType<typeof createApp>;

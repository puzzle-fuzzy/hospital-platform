import cors from "@elysiajs/cors";
import openapi from "@elysiajs/openapi";
import { configureProviderRequestLogger } from "@hospital/adapters";
import { DependencyNotConfiguredError } from "@hospital/domain";
import {
	type AdminLogStore,
	type AppLogger,
	createAdminLogStore,
	createNoopLogger,
} from "@hospital/observability";
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
import { adminInsuranceQueryModule, adminLogsModule } from "./modules/admin";
import type { AppointmentWriteService } from "./modules/appointments";
import { appointmentsModule } from "./modules/appointments";
import { authModule } from "./modules/auth";
import { healthModule } from "./modules/health";
import { inpatientEpisodesModule } from "./modules/inpatient";
import { intelligentCustomerModule } from "./modules/intelligent-customer";
import {
	type IntelligentGuideService,
	intelligentGuideModule,
} from "./modules/intelligent-guide";
import { healthKnowledgeModule } from "./modules/knowledge";
import type { MedicalInsuranceRegistrationService } from "./modules/medical-insurance";
import { medicalInsuranceModule } from "./modules/medical-insurance";
import type { MedicalInsurancePluginPaymentService } from "./modules/medical-insurance/plugin-payment-service";
import type { MedicalInsuranceNotificationService } from "./modules/medical-insurance/service";
import type { MedicalInsuranceWechatPaymentService } from "./modules/medical-insurance/wechat-payment-service";
import { medicalRecordsModule } from "./modules/medical-records";
import { myDoctorsModule } from "./modules/my-doctors";
import { outpatientPaymentsModule } from "./modules/outpatient-payments";
import { PatientBindingService, patientsModule } from "./modules/patients";
import { paymentsModule } from "./modules/payments";
import type { RegistrationPaymentExitService } from "./modules/payments/registration-payment-exit-service";
import type { RegistrationSelfPayService } from "./modules/payments/registration-self-pay-service";
import { yunhealthPaymentQueryModule } from "./modules/payments/yunhealth-payment-query";
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
	/** 挂号自费与普通自费共用官方微信支付 APIv3。 */
	registrationSelfPayEnabled?: boolean;
	/** 临时联调：false 时不注册众阳 2.6.65.9 反向查询路由。 */
	yunhealthPaymentQueryEnabled?: boolean;
	/** 智能客服独立部署闸门；默认关闭，不能因注入 service 而意外公开。 */
	intelligentCustomerEnabled?: boolean;
	/**
	 * 医保结算通知模块；未传入 service 时不注册路由（组合根级 fail-closed）。
	 * 生产组合根只有在 MEDICAL_INSURANCE_READY 与完整密钥配置下才构造。
	 */
	medicalInsuranceNotification?: MedicalInsuranceNotificationService;
	/** 官方微信 APIv3 医保混合支付回调；验签、解密和 HIS 收敛由服务端完成。 */
	wechatMedicalInsurancePaymentNotification?: (input: {
		rawBody: Uint8Array;
		headers: Headers;
		receivedAt: string;
	}) => Promise<void>;
	/** 新服务独立 Admin 1101 查询的服务间令牌。 */
	adminQueryToken?: string;
	/** 新服务独立 Admin 日志读模型；默认使用有界进程内窗口。 */
	adminLogStore?: AdminLogStore;
	/** 管理端日志读模型的独立服务间令牌。 */
	adminLogsToken?: string;
	/** Worker 上送安全日志元数据的独立服务间令牌。 */
	adminLogsIngestToken?: string;
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
				{
					name: "intelligent-customer",
					description: "智能客服（独立部署闸门）",
				},
				{ name: "reports", description: "检查检验报告目录" },
				{ name: "medical-records", description: "门诊就诊摘要只读目录" },
				{ name: "inpatient-episodes", description: "住院摘要只读目录" },
				{ name: "payments", description: "支付订单" },
			],
		},
	});
}

export function createApp(options: AppOptions = {}) {
	const logger = options.logger ?? createNoopLogger();
	const adminLogStore = options.adminLogStore ?? createAdminLogStore();
	// 所有 adapter 的 provider 请求都经过 requestJson；在组合根注册统一
	// logger 后，预约、就诊人、门诊费用、医保和微信接口会共享同一套审计事件。
	configureProviderRequestLogger(logger);
	const readiness =
		options.readiness ??
		createReadinessService({
			databaseConfigured: Boolean(config.databaseUrl),
			redisConfigured: Boolean(config.redisUrl),
			schemaReady: config.persistenceSchemaReady,
		});
	const services = options.services ?? createDefaultApplicationServices();
	const patientBinding =
		services.patientBinding ??
		new PatientBindingService({
			patients: services.patients,
			gateway: {
				bind: async () => {
					throw new DependencyNotConfiguredError("patient-binding");
				},
			},
		});
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
			getDetail: async () => {
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
	const medicalInsuranceWechatPayment =
		services.medicalInsuranceWechatPayment ??
		({
			create: async () => {
				throw new DependencyNotConfiguredError(
					"medical-insurance-wechat-payment",
				);
			},
			query: async () => {
				throw new DependencyNotConfiguredError(
					"medical-insurance-wechat-payment",
				);
			},
		} as unknown as MedicalInsuranceWechatPaymentService);
	const medicalInsurancePluginPayment =
		services.medicalInsurancePluginPayment ??
		({
			create: async () => {
				throw new DependencyNotConfiguredError(
					"medical-insurance-plugin-payment",
				);
			},
			query: async () => {
				throw new DependencyNotConfiguredError(
					"medical-insurance-plugin-payment",
				);
			},
		} as unknown as MedicalInsurancePluginPaymentService);
	const intelligentGuide =
		services.intelligentGuide ??
		({
			chatText: async () => {
				throw new DependencyNotConfiguredError("intelligent-guide");
			},
			chatAudio: async () => {
				throw new DependencyNotConfiguredError("intelligent-guide");
			},
		} as unknown as IntelligentGuideService);
	const intelligentCustomerEnabled =
		options.intelligentCustomerEnabled ?? config.intelligentCustomerEnabled;
	const registrationSelfPay =
		services.registrationSelfPay ??
		({
			create: async () => {
				throw new DependencyNotConfiguredError("registration-self-pay");
			},
			query: async () => {
				throw new DependencyNotConfiguredError("registration-self-pay");
			},
		} as unknown as RegistrationSelfPayService);
	const registrationPaymentExit =
		services.registrationPaymentExit ??
		({
			abandon: async () => {
				throw new DependencyNotConfiguredError("registration-payment-exit");
			},
		} as unknown as RegistrationPaymentExitService);

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
		.use(
			options.yunhealthPaymentQueryEnabled !== false &&
				services.yunhealthPaymentQuery
				? yunhealthPaymentQueryModule(services.yunhealthPaymentQuery, logger)
				: new Elysia({ name: "yunhealth-payment-query-not-configured" }),
		)
		.group("/api/v1", (api) =>
			api
				// 管理端查询沿用新服务的内部 v1 命名空间，但不挂患者会话中间件。
				.use(
					services.adminInsuranceQuery && options.adminQueryToken?.trim()
						? adminInsuranceQueryModule(
								services.adminInsuranceQuery,
								options.adminQueryToken,
							)
						: new Elysia({ name: "admin-insurance-query-not-configured" }),
				)
				.use(
					adminLogsModule(
						adminLogStore,
						options.adminLogsToken,
						options.adminLogsIngestToken,
					),
				)
				.use(systemModule())
				.use(authModule(services.auth, services.sessions))
				.use(
					services.healthKnowledge
						? healthKnowledgeModule(services.healthKnowledge, services.sessions)
						: new Elysia({ name: "health-knowledge-not-configured" }),
				)
				.use(intelligentGuideModule(intelligentGuide, services.sessions))
				.use(
					intelligentCustomerEnabled && services.intelligentCustomer
						? intelligentCustomerModule(
								services.intelligentCustomer,
								services.sessions,
							)
						: new Elysia({ name: "intelligent-customer-disabled" }),
				)
				.use(
					services.profile
						? profileModule(services.profile, services.sessions)
						: new Elysia({ name: "profile-not-configured" }),
				)
				.use(
					patientsModule(services.patients, patientBinding, services.sessions),
				)
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
					services.medicalRecords
						? medicalRecordsModule(services.medicalRecords, services.sessions)
						: new Elysia({ name: "medical-records-not-configured" }),
				)
				.use(
					services.inpatientEpisodes
						? inpatientEpisodesModule(
								services.inpatientEpisodes,
								services.sessions,
							)
						: new Elysia({ name: "inpatient-episodes-not-configured" }),
				)
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
						options.registrationSelfPayEnabled ??
							options.wechatPaymentEnabled === true,
						registrationSelfPay,
						registrationPaymentExit,
					),
				)
				.use(
					medicalInsuranceModule(
						medicalInsurance,
						services.sessions,
						medicalInsuranceWechatPayment,
						medicalInsurancePluginPayment,
						options.medicalInsuranceNotification,
						options.wechatMedicalInsurancePaymentNotification,
					),
				),
		);

	return app;
}

export type HospitalApp = ReturnType<typeof createApp>;

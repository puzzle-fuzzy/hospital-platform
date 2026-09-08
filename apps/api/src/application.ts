import { createHash } from "node:crypto";
import { createNotConfiguredGateways } from "@hospital/adapters";
import type { DependencyState } from "@hospital/contracts";
import type {
	AppointmentDepartmentTreeGateway,
	AppointmentDirectoryGateway,
	AppointmentPatientProfileGateway,
	AppointmentRecordDirectoryGateway,
	AppointmentWriteGateway,
	HospitalSettlementGateway,
	OutpatientPaymentGateway,
	PatientBindingGateway,
	PatientDirectoryGateway,
	PatientProviderAuthorizationGateway,
	PaymentOrder,
	RegistrationSelfPayPreparationGateway,
	RegistrationSelfPaySettlementContext,
	ReportDetailGateway,
	ReportDirectoryGateway,
	WechatIdentityGateway,
	WechatPaymentGateway,
	YunhealthRegistrationPluginPaymentGateway,
} from "@hospital/domain";
import {
	DependencyNotConfiguredError,
	PaymentOrderService,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import type {
	MySqlRepositories,
	RedisSessionStore,
} from "@hospital/persistence";
import { createNotConfiguredRepositories } from "@hospital/persistence";
import { AppointmentService } from "./modules/appointments";
import { AppointmentWriteService } from "./modules/appointments/write-service";
import {
	AuthService,
	createNotConfiguredSessionTokenService,
	createRedisSessionTokenService,
	type SessionTokenService,
} from "./modules/auth";
import { HealthKnowledgeService } from "./modules/knowledge";
import { MedicalInsurancePaymentCore } from "./modules/medical-insurance/payment-core";
import { MedicalInsurancePluginPaymentService } from "./modules/medical-insurance/plugin-payment-service";
import { MedicalInsuranceRegistrationService } from "./modules/medical-insurance/registration-service";
import { MedicalInsuranceWechatPaymentService } from "./modules/medical-insurance/wechat-payment-service";
import { MyDoctorService } from "./modules/my-doctors";
import { OutpatientPaymentService } from "./modules/outpatient-payments";
import { PatientService } from "./modules/patients";
import { PatientBindingService } from "./modules/patients/binding-service";
import { WechatPrepayService } from "./modules/payments";
import {
	type WechatPaymentNotificationDecoder,
	WechatPaymentNotificationService,
} from "./modules/payments/notification-service";
import { RegistrationPaymentExitService } from "./modules/payments/registration-payment-exit-service";
import { RegistrationSelfPayService } from "./modules/payments/registration-self-pay-service";
import { UserProfileService } from "./modules/profile";
import { ReportService } from "./modules/reports";

export type ApplicationServices = {
	auth: AuthService;
	patients: PatientService;
	patientBinding?: PatientBindingService;
	appointments: AppointmentService;
	appointmentWrites?: AppointmentWriteService;
	medicalInsurance?: MedicalInsuranceRegistrationService;
	/** 挂号与门诊共享的 6202/6301/CAS 支付核心。 */
	medicalInsuranceCore?: MedicalInsurancePaymentCore;
	medicalInsuranceWechatPayment?: MedicalInsuranceWechatPaymentService;
	/** 云健康插件链路按配置闸门启用，负责 .2/.29/.15/.5 后置回写。 */
	medicalInsurancePluginPayment?: import("./modules/medical-insurance/plugin-payment-service").MedicalInsurancePluginPaymentService;
	myDoctors?: MyDoctorService;
	outpatientPayments?: OutpatientPaymentService;
	/** 健康百科只读模块；未发布审核内容时由仓储保持 fail-closed。 */
	healthKnowledge?: HealthKnowledgeService;
	reports: ReportService;
	paymentOrders: PaymentOrderService;
	wechatPrepay: WechatPrepayService;
	/** 挂号自费与其他普通自费共用官方微信 APIv3 收银台。 */
	registrationWechatPrepay?: WechatPrepayService;
	registrationSelfPay?: RegistrationSelfPayService;
	registrationPaymentExit?: RegistrationPaymentExitService;
	wechatPaymentNotifications: WechatPaymentNotificationService;
	/** 普通资料模块在默认组合根启用；自定义测试组合根可省略以保持 fail-closed。 */
	profile?: UserProfileService;
	sessions: SessionTokenService;
};

export type ApplicationServiceOptions = {
	/** 生产入口注入同一个 Pino logger，保证业务事件进入 journald/集中采集。 */
	logger?: AppLogger;
	/** 只有完成 schema migration 后才从 persistence runtime 注入。 */
	repositories?: MySqlRepositories;
	/** Redis 未配置时必须保持 fail-closed。 */
	sessionStore?: RedisSessionStore;
	/** 只有配置闸门打开时才允许注入真实微信身份 adapter。 */
	identityGateway?: WechatIdentityGateway;
	/** 只有完成微信支付商户配置和回调验收后才打开。 */
	wechatPaymentGateway?: WechatPaymentGateway;
	/** 微信自费支付成功后，必须由该网关完成 HIS 回写；未配置时保持 pending。 */
	hospitalSettlementGateway?: HospitalSettlementGateway;
	/** 普通挂号自费在微信下单前固定执行 .1 -> .32 -> .2。 */
	registrationSelfPayPreparationGateway?: RegistrationSelfPayPreparationGateway;
	/** 只有完成众阳/HIS 合同和真实环境验收后才打开。 */
	patientDirectoryGateway?: PatientDirectoryGateway;
	/** 新增或绑定就诊人必须使用独立的查档/建档/绑卡 adapter。 */
	patientBindingGateway?: PatientBindingGateway;
	/** 旧服务端微信登录，用于取得众阳 patCards 的用户级 JWT。 */
	patientProviderAuthorizationGateway?: PatientProviderAuthorizationGateway;
	/** 只有完成众阳 AMC 只读目录合同和真实环境验收后才打开。 */
	appointmentDirectoryGateway?: AppointmentDirectoryGateway;
	/** 挂号页一级/二级树及受控三级科室读取，独立于既有扁平目录契约。 */
	appointmentDepartmentTreeGateway?: AppointmentDepartmentTreeGateway;
	/** 预约历史使用独立 endpoint，必须独立完成合同和真实环境验收。 */
	appointmentRecordDirectoryGateway?: AppointmentRecordDirectoryGateway;
	/** 预约写入使用独立的患者实名解析与写入 adapter。 */
	appointmentPatientProfileGateway?: AppointmentPatientProfileGateway;
	appointmentWriteGateway?: AppointmentWriteGateway;
	/** 门诊费用只读目录；支付和医保结算不由该网关隐式开启。 */
	outpatientPaymentGateway?: OutpatientPaymentGateway;
	outpatientPaymentAuthSysCode?: string;
	/** 只有完成众阳 LIS/PACS/ECG 只读合同和真实环境验收后才打开。 */
	reportDirectoryGateway?: ReportDirectoryGateway;
	/** LIS 详情必须单独完成资源授权、引用落库和真实环境验收后才打开。 */
	reportDetailGateway?: ReportDetailGateway;
	/** APIv3 验签、解密和白名单映射只从组合根注入。 */
	wechatPaymentNotificationDecoder?: WechatPaymentNotificationDecoder;
	/** 医保授权、费用上传、结算和查单的真实 adapter；未配置时 fail-closed。 */
	medicalInsuranceGateway?: import("@hospital/domain").MedicalInsuranceGateway;
	/** 官方微信医保混合支付 adapter；未配置时保持 fail-closed。 */
	medicalInsuranceWechatPaymentGateway?: import("@hospital/domain").MedicalInsuranceWechatPaymentGateway;
	/** 旧服务第二次云健康 .2 插件预下单；未配置时保持 fail-closed。 */
	yunhealthRegistrationPluginPaymentGateway?: YunhealthRegistrationPluginPaymentGateway;
	yunhealthRegistrationPluginPayTypeId?: string;
	yunhealthRegistrationPluginPayType?: "CREDIT" | "POS" | "CROWD_FUNDING";
	yunhealthRegistrationWorkStationId?: string;
	yunhealthRegistrationTradeTypeCode?: string;
};

/**
 * 人工 schema gate 只是部署意图；只有实际只读 probe 为 ok 才能安装生产 repository。
 * 这样 API 在 migration 不完整时仍可提供 health/readiness，但不会运行半成品业务写入。
 */
export function selectReadyRepositories(
	repositories: MySqlRepositories | undefined,
	schemaProbe: DependencyState,
): MySqlRepositories | undefined {
	return schemaProbe === "ok" ? repositories : undefined;
}

/**
 * 优先从普通自费支付订单密文读取 Provider 关联事实；历史订单才回退到同预约
 * 医保结算密文。这里不接受客户端字段，也不从平台订单号推导。
 */
function resolveRegistrationSelfPayContext(
	repositories: Pick<
		MySqlRepositories,
		"medicalInsuranceOrders" | "paymentOrders"
	>,
) {
	const contextText = (
		value: Record<string, unknown>,
		keys: readonly string[],
	): string | undefined => {
		for (const key of keys) {
			const candidate = value[key];
			if (typeof candidate !== "string" && typeof candidate !== "number")
				continue;
			const normalized = String(candidate).trim();
			if (normalized) return normalized;
		}
		return undefined;
	};

	return async (input: {
		ownerUserId: string;
		orderId?: string;
		appointmentId?: string;
		medicalOrderId?: string;
	}): Promise<RegistrationSelfPaySettlementContext | undefined> => {
		if (
			input.orderId &&
			repositories.paymentOrders.getRegistrationSelfPayContext
		) {
			const selfPayContext =
				await repositories.paymentOrders.getRegistrationSelfPayContext(
					input.ownerUserId,
					input.orderId,
				);
			if (selfPayContext) return selfPayContext;
		}
		const medicalOrder = input.medicalOrderId
			? await repositories.medicalInsuranceOrders.findByMedicalOrderId(
					input.medicalOrderId,
				)
			: input.appointmentId
				? await repositories.medicalInsuranceOrders.findByOwnerAndAppointmentId(
						input.ownerUserId,
						input.appointmentId,
					)
				: undefined;
		if (!medicalOrder || medicalOrder.ownerUserId !== input.ownerUserId) {
			return undefined;
		}
		if (!medicalOrder?.payOrdId) return undefined;
		const settlement =
			await repositories.medicalInsuranceOrders.getSettlementContext(
				input.ownerUserId,
				medicalOrder.medicalOrderId,
			);
		if (!settlement) return undefined;
		const providerContext = settlement.plugin ?? settlement;
		if (
			!settlement.businessId.trim() ||
			!/^[0-9]+$/.test(providerContext.payingId) ||
			!/^[0-9]+$/.test(providerContext.tradingId)
		) {
			return undefined;
		}
		const networkRegister = settlement.networkRegister;
		const hospitalId = settlement.hospitalId.trim();
		const patientId = settlement.patientId.trim();
		const certNo = contextText(networkRegister, [
			"idNo",
			"id_no",
			"certNo",
			"cert_no",
		]);
		const psnName = contextText(networkRegister, [
			"netPatName",
			"net_pat_name",
			"psnName",
			"psn_name",
		]);
		const psnNo = contextText(networkRegister, [
			"memberNo",
			"member_no",
			"psnNo",
			"psn_no",
		]);
		if (!hospitalId || !patientId || !certNo || !psnName || !psnNo) {
			return undefined;
		}
		return {
			businessId: settlement.businessId,
			payingId: providerContext.payingId,
			tradingId: providerContext.tradingId,
			hospitalId,
			patientId,
			certNo,
			// 1101 当前使用居民身份证类型 01；若将来 Provider 合同支持
			// 其他证件类型，应随结算上下文持久化，而不是从客户端读取。
			psnCertType:
				contextText(networkRegister, [
					"psnCertType",
					"psn_cert_type",
					"idType",
					"id_type",
				]) ?? "01",
			psnName,
			psnNo,
			patInHosId:
				contextText(networkRegister, ["patInHosId", "pat_in_hos_id"]) ?? "0",
			...(settlement.plugin
				? {
						outTradeNo: settlement.plugin.outTradeNo,
						recordCode: settlement.plugin.recordCode,
						payTypeId: settlement.plugin.payTypeId,
						payType: settlement.plugin.payType,
						workStationId: settlement.plugin.workStationId,
						...(settlement.plugin.thirdPartPayRecordId
							? {
									thirdPartPayRecordId: settlement.plugin.thirdPartPayRecordId,
								}
							: {}),
					}
				: {}),
		};
	};
}

/**
 * 普通挂号自费若复用云健康插件上下文，也必须把 .29 原文保存到同一份密文
 * settlement context。日志只记录长度和哈希，便于排查而不暴露 Provider 报文。
 */
function persistThirdPartPayResponse(
	repositories: Pick<
		MySqlRepositories,
		"medicalInsuranceOrders" | "paymentOrders"
	>,
	logger?: AppLogger,
) {
	const auditLogger = logger ?? createNoopLogger();
	return async (input: {
		ownerUserId: string;
		appointmentId: string;
		paymentOrder: PaymentOrder;
		registrationContext?: RegistrationSelfPaySettlementContext;
		rawResponse: string;
		thirdPartPayRecordId: string;
	}): Promise<void> => {
		let selfPayContextPersisted = false;
		if (
			input.registrationContext &&
			repositories.paymentOrders.saveRegistrationSelfPayContext
		) {
			await repositories.paymentOrders.saveRegistrationSelfPayContext(
				input.ownerUserId,
				input.paymentOrder.orderId,
				{
					...input.registrationContext,
					thirdPartPayRecordId: input.thirdPartPayRecordId,
					thirdPartPayRawResponse: input.rawResponse,
				},
			);
			auditLogger.info(
				{
					event: "appointment.self-payment.2.27.2.29.persisted",
					ownerUserId: input.ownerUserId,
					appointmentId: input.appointmentId,
					paymentOrderId: input.paymentOrder.orderId,
					thirdPartPayRecordId: input.thirdPartPayRecordId,
					rawResponseBytes: new TextEncoder().encode(input.rawResponse)
						.byteLength,
					rawResponseSha256: createHash("sha256")
						.update(input.rawResponse)
						.digest("hex"),
				},
				"Registration self-pay Yunhealth 2.27.2.29 raw response persisted",
			);
			selfPayContextPersisted = true;
		}
		const medicalOrder =
			await repositories.medicalInsuranceOrders.findByOwnerAndAppointmentId(
				input.ownerUserId,
				input.appointmentId,
			);
		const settlement = medicalOrder
			? await repositories.medicalInsuranceOrders.getSettlementContext(
					input.ownerUserId,
					medicalOrder.medicalOrderId,
				)
			: undefined;
		const plugin = settlement?.plugin;
		if (
			!medicalOrder ||
			!plugin ||
			plugin.paymentOrderId !== input.paymentOrder.orderId
		) {
			if (!selfPayContextPersisted) {
				auditLogger.warn(
					{
						event: "medical-insurance.plugin.2.27.2.29.storage-skipped",
						ownerUserId: input.ownerUserId,
						appointmentId: input.appointmentId,
						paymentOrderId: input.paymentOrder.orderId,
						reason: "plugin-context-missing-or-mismatched",
					},
					"Medical insurance Yunhealth 2.27.2.29 response was not persisted",
				);
			}
			return;
		}
		await repositories.medicalInsuranceOrders.saveSettlementContext(
			input.ownerUserId,
			medicalOrder.medicalOrderId,
			{
				...settlement,
				plugin: {
					...plugin,
					thirdPartPayRecordId: input.thirdPartPayRecordId,
					thirdPartPayRawResponse: input.rawResponse,
					state: "29_succeeded",
				},
			},
		);
		auditLogger.info(
			{
				event: "medical-insurance.plugin.2.27.2.29.persisted",
				ownerUserId: input.ownerUserId,
				appointmentId: input.appointmentId,
				paymentOrderId: input.paymentOrder.orderId,
				thirdPartPayRecordId: input.thirdPartPayRecordId,
				rawResponseBytes: new TextEncoder().encode(input.rawResponse)
					.byteLength,
				rawResponseSha256: createHash("sha256")
					.update(input.rawResponse)
					.digest("hex"),
			},
			"Medical insurance Yunhealth 2.27.2.29 raw response persisted",
		);
	};
}

/** 默认组合根只安装 fail-closed 依赖，避免开发环境误连真实 provider。 */
export function createDefaultApplicationServices(
	options: ApplicationServiceOptions = {},
): ApplicationServices {
	const gateways = createNotConfiguredGateways();
	const identityGateway = options.identityGateway ?? gateways.wechatIdentity;
	const repositories =
		options.repositories ?? createNotConfiguredRepositories();
	const sessions = options.sessionStore
		? createRedisSessionTokenService(options.sessionStore)
		: createNotConfiguredSessionTokenService();
	const paymentOrders = new PaymentOrderService({
		orders: repositories.paymentOrders,
		quotes: repositories.paymentQuotes,
	});
	const appointments = new AppointmentService({
		directory:
			options.appointmentDirectoryGateway ?? gateways.appointmentDirectory,
		departmentTree:
			options.appointmentDepartmentTreeGateway ??
			gateways.appointmentDepartmentTree,
		repository: repositories.patients,
		records:
			options.appointmentRecordDirectoryGateway ?? gateways.appointmentRecords,
		appointmentWrites: repositories.appointmentWrites,
		snapshots: repositories.appointmentScheduleSnapshots,
		...(options.logger ? { logger: options.logger } : {}),
	});
	const appointmentWrites = new AppointmentWriteService({
		repository: repositories.appointmentWrites,
		patients: repositories.patients,
		identityUsers: repositories.identityUsers,
		patientProfile:
			options.appointmentPatientProfileGateway ??
			gateways.appointmentPatientProfile,
		gateway: options.appointmentWriteGateway ?? gateways.appointmentWrites,
		medicalInsuranceOrders: repositories.medicalInsuranceOrders,
		paymentOrders: repositories.paymentOrders,
		snapshots: repositories.appointmentScheduleSnapshots,
		...(options.logger ? { logger: options.logger } : {}),
	});
	const medicalInsuranceCore = new MedicalInsurancePaymentCore({
		orders: repositories.medicalInsuranceOrders,
		medicalInsurance:
			options.medicalInsuranceGateway ?? gateways.medicalInsurance,
		queryTasks: repositories.medicalInsuranceQueryTasks,
		...(options.logger ? { logger: options.logger } : {}),
	});
	const medicalInsurance = new MedicalInsuranceRegistrationService({
		orders: repositories.medicalInsuranceOrders,
		appointments: repositories.appointmentWrites,
		patients: repositories.patients,
		identityUsers: repositories.identityUsers,
		patientProfile:
			options.appointmentPatientProfileGateway ??
			gateways.appointmentPatientProfile,
		medicalInsurance:
			options.medicalInsuranceGateway ?? gateways.medicalInsurance,
		core: medicalInsuranceCore,
		...(options.logger ? { logger: options.logger } : {}),
	});
	const wechatPrepay = new WechatPrepayService({
		orders: paymentOrders,
		identityUsers: repositories.identityUsers,
		attempts: repositories.paymentPrepayAttempts,
		wechatPayment: options.wechatPaymentGateway ?? gateways.wechatPayment,
		...(options.logger ? { logger: options.logger } : {}),
	});
	// 挂号自费和历史插件版医保支付共用官方 APIv3 WechatPrepayService；
	// 旧链路的云健康 .2 只负责建立 HIS 关联流水，不再创建 v2 微信订单。
	const registrationWechatPrepay = wechatPrepay;
	const medicalInsurancePluginPayment =
		new MedicalInsurancePluginPaymentService({
			orders: repositories.medicalInsuranceOrders,
			authorizations: repositories.medicalInsuranceAuthorizations,
			identityUsers: repositories.identityUsers,
			paymentOrders,
			wechatPrepay,
			pluginPayment:
				options.yunhealthRegistrationPluginPaymentGateway ??
				gateways.yunhealthRegistrationPluginPayment,
			hospitalSettlement:
				options.hospitalSettlementGateway ?? gateways.hospitalSettlement,
			pluginPayTypeId: options.yunhealthRegistrationPluginPayTypeId ?? "",
			pluginPayType: options.yunhealthRegistrationPluginPayType ?? "CREDIT",
			pluginWorkStationId: options.yunhealthRegistrationWorkStationId ?? "",
			pluginTradeTypeCode: options.yunhealthRegistrationTradeTypeCode ?? "10",
			...(options.logger ? { logger: options.logger } : {}),
		});
	const medicalInsuranceWechatPayment =
		new MedicalInsuranceWechatPaymentService({
			orders: repositories.medicalInsuranceOrders,
			queryTasks: repositories.medicalInsuranceQueryTasks,
			authorizations: repositories.medicalInsuranceAuthorizations,
			identityUsers: repositories.identityUsers,
			patients: repositories.patients,
			wechatPayment:
				options.medicalInsuranceWechatPaymentGateway ??
				gateways.medicalInsuranceWechatPayment,
			confirmCashPayment: (input) =>
				medicalInsuranceCore.confirmWechatCashPayment(input),
			...(options.medicalInsuranceWechatPaymentGateway &&
			options.yunhealthRegistrationPluginPaymentGateway &&
			options.hospitalSettlementGateway
				? { pluginPaymentBridge: medicalInsurancePluginPayment }
				: {}),
			...(options.logger ? { logger: options.logger } : {}),
		});
	const registrationSelfPay = new RegistrationSelfPayService({
		appointments: appointmentWrites,
		paymentOrders,
		wechatPrepay: registrationWechatPrepay,
		hospitalSettlement:
			options.hospitalSettlementGateway ?? gateways.hospitalSettlement,
		preparation:
			options.registrationSelfPayPreparationGateway ??
			gateways.registrationSelfPayPreparation,
		resolveRegistrationContext: resolveRegistrationSelfPayContext(repositories),
		saveRegistrationContext: async (input) => {
			if (!repositories.paymentOrders.saveRegistrationSelfPayContext) {
				throw new DependencyNotConfiguredError("payment-orders");
			}
			await repositories.paymentOrders.saveRegistrationSelfPayContext(
				input.ownerUserId,
				input.orderId,
				input.registrationContext,
			);
		},
		onThirdPartPayResponse: persistThirdPartPayResponse(
			repositories,
			options.logger,
		),
		...(options.logger ? { logger: options.logger } : {}),
	});
	const registrationPaymentExit = new RegistrationPaymentExitService({
		appointments: appointmentWrites,
		medicalInsurance,
		medicalInsuranceWechatPayment,
		medicalInsuranceOrders: repositories.medicalInsuranceOrders,
		paymentOrders,
		wechatPrepay: registrationWechatPrepay,
		...(options.logger ? { logger: options.logger } : {}),
	});
	const patients = new PatientService(repositories.patients, {
		identityUsers: repositories.identityUsers,
		directory: options.patientDirectoryGateway ?? gateways.patientDirectory,
		...(options.logger ? { logger: options.logger } : {}),
	});

	return {
		auth: new AuthService({
			identityGateway,
			identityUsers: repositories.identityUsers,
			sessions,
			...(options.logger ? { logger: options.logger } : {}),
		}),
		patients,
		patientBinding: new PatientBindingService({
			patients,
			gateway:
				options.patientBindingGateway ??
				({
					bind: async () => {
						throw new DependencyNotConfiguredError("patient-binding");
					},
				} satisfies PatientBindingGateway),
			identityUsers: repositories.identityUsers,
			...(options.patientProviderAuthorizationGateway
				? {
						providerAuthorizationGateway:
							options.patientProviderAuthorizationGateway,
					}
				: {}),
			...(options.logger ? { logger: options.logger } : {}),
		}),
		appointments,
		appointmentWrites,
		medicalInsurance,
		medicalInsuranceCore,
		medicalInsuranceWechatPayment,
		medicalInsurancePluginPayment,
		myDoctors: new MyDoctorService({
			repository: repositories.myDoctors,
			appointments,
			...(options.logger ? { logger: options.logger } : {}),
		}),
		reports: new ReportService({
			repository: repositories.patients,
			directory: options.reportDirectoryGateway ?? gateways.reportDirectory,
			references: repositories.reportReferences,
			...(options.reportDetailGateway
				? { detail: options.reportDetailGateway }
				: {}),
			...(options.logger ? { logger: options.logger } : {}),
		}),
		outpatientPayments: new OutpatientPaymentService({
			repository: repositories.patients,
			gateway: options.outpatientPaymentGateway ?? gateways.outpatientPayments,
			// 渠道码必须来自已确认的运行配置；缺失时由服务层 fail-closed，
			// 不能在组合根再次猜测 Provider 渠道。
			authSysCode: options.outpatientPaymentAuthSysCode ?? "",
			...(options.logger ? { logger: options.logger } : {}),
		}),
		healthKnowledge: new HealthKnowledgeService({
			repository: repositories.healthKnowledge,
			...(options.logger ? { logger: options.logger } : {}),
		}),
		paymentOrders,
		wechatPrepay,
		registrationWechatPrepay,
		registrationSelfPay,
		registrationPaymentExit,
		wechatPaymentNotifications: new WechatPaymentNotificationService({
			notifications: repositories.wechatPaymentNotifications,
			decoder:
				options.wechatPaymentNotificationDecoder ??
				((() => {
					throw new DependencyNotConfiguredError(
						"wechat-payment-notifications",
					);
				}) as WechatPaymentNotificationDecoder),
			medicalInsuranceCashNotification: (input) =>
				medicalInsuranceWechatPayment.receiveCashNotification(input),
			...(options.logger ? { logger: options.logger } : {}),
		}),
		profile: new UserProfileService(repositories.userProfiles, {
			...(options.logger ? { logger: options.logger } : {}),
		}),
		sessions,
	};
}

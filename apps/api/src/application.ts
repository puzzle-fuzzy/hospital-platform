import { createNotConfiguredGateways } from "@hospital/adapters";
import type { DependencyState } from "@hospital/contracts";
import type {
	AppointmentDepartmentTreeGateway,
	AppointmentDirectoryGateway,
	AppointmentRecordDirectoryGateway,
	OutpatientPaymentGateway,
	PatientDirectoryGateway,
	ReportDetailGateway,
	ReportDirectoryGateway,
	WechatIdentityGateway,
	WechatPaymentGateway,
} from "@hospital/domain";
import {
	DependencyNotConfiguredError,
	PaymentOrderService,
} from "@hospital/domain";
import type { AppLogger } from "@hospital/observability";
import type {
	MySqlRepositories,
	RedisSessionStore,
} from "@hospital/persistence";
import { createNotConfiguredRepositories } from "@hospital/persistence";
import { AppointmentService } from "./modules/appointments";
import {
	AuthService,
	createNotConfiguredSessionTokenService,
	createRedisSessionTokenService,
	type SessionTokenService,
} from "./modules/auth";
import { HealthKnowledgeService } from "./modules/knowledge";
import { MyDoctorService } from "./modules/my-doctors";
import { OutpatientPaymentService } from "./modules/outpatient-payments";
import { PatientService } from "./modules/patients";
import { WechatPrepayService } from "./modules/payments";
import {
	type WechatPaymentNotificationDecoder,
	WechatPaymentNotificationService,
} from "./modules/payments/notification-service";
import { UserProfileService } from "./modules/profile";
import { ReportService } from "./modules/reports";

export type ApplicationServices = {
	auth: AuthService;
	patients: PatientService;
	appointments: AppointmentService;
	myDoctors?: MyDoctorService;
	outpatientPayments?: OutpatientPaymentService;
	/** 健康百科只读模块；未发布审核内容时由仓储保持 fail-closed。 */
	healthKnowledge?: HealthKnowledgeService;
	reports: ReportService;
	paymentOrders: PaymentOrderService;
	wechatPrepay: WechatPrepayService;
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
	/** 只有完成众阳/HIS 合同和真实环境验收后才打开。 */
	patientDirectoryGateway?: PatientDirectoryGateway;
	/** 只有完成众阳 AMC 只读目录合同和真实环境验收后才打开。 */
	appointmentDirectoryGateway?: AppointmentDirectoryGateway;
	/** 挂号页一级/二级树及受控三级科室读取，独立于既有扁平目录契约。 */
	appointmentDepartmentTreeGateway?: AppointmentDepartmentTreeGateway;
	/** 预约历史使用独立 endpoint，必须独立完成合同和真实环境验收。 */
	appointmentRecordDirectoryGateway?: AppointmentRecordDirectoryGateway;
	/** 门诊费用只读目录；支付和医保结算不由该网关隐式开启。 */
	outpatientPaymentGateway?: OutpatientPaymentGateway;
	outpatientPaymentAuthSysCode?: string;
	/** 只有完成众阳 LIS/PACS/ECG 只读合同和真实环境验收后才打开。 */
	reportDirectoryGateway?: ReportDirectoryGateway;
	/** LIS 详情必须单独完成资源授权、引用落库和真实环境验收后才打开。 */
	reportDetailGateway?: ReportDetailGateway;
	/** APIv3 验签、解密和白名单映射只从组合根注入。 */
	wechatPaymentNotificationDecoder?: WechatPaymentNotificationDecoder;
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
		snapshots: repositories.appointmentScheduleSnapshots,
		...(options.logger ? { logger: options.logger } : {}),
	});

	return {
		auth: new AuthService({
			identityGateway,
			identityUsers: repositories.identityUsers,
			sessions,
			...(options.logger ? { logger: options.logger } : {}),
		}),
		patients: new PatientService(repositories.patients, {
			identityUsers: repositories.identityUsers,
			directory: options.patientDirectoryGateway ?? gateways.patientDirectory,
			...(options.logger ? { logger: options.logger } : {}),
		}),
		appointments,
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
		wechatPrepay: new WechatPrepayService({
			orders: paymentOrders,
			identityUsers: repositories.identityUsers,
			attempts: repositories.paymentPrepayAttempts,
			wechatPayment: options.wechatPaymentGateway ?? gateways.wechatPayment,
			...(options.logger ? { logger: options.logger } : {}),
		}),
		wechatPaymentNotifications: new WechatPaymentNotificationService({
			notifications: repositories.wechatPaymentNotifications,
			decoder:
				options.wechatPaymentNotificationDecoder ??
				((() => {
					throw new DependencyNotConfiguredError(
						"wechat-payment-notifications",
					);
				}) as WechatPaymentNotificationDecoder),
			...(options.logger ? { logger: options.logger } : {}),
		}),
		profile: new UserProfileService(repositories.userProfiles, {
			...(options.logger ? { logger: options.logger } : {}),
		}),
		sessions,
	};
}

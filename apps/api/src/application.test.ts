import { expect, test } from "bun:test";
import { createYunhealthRegistrationSelfPayRefundNotificationGateway } from "@hospital/adapters";
import {
	loadRuntimeConfig,
	yunhealthRegistrationRefundAuthorizationStatus,
	yunhealthRegistrationSettlementConfigurationStatus,
} from "@hospital/config";
import type {
	AppointmentDirectoryGateway,
	IntelligentGuideConversationStateStore,
	PaymentOrder,
} from "@hospital/domain";
import { DependencyNotConfiguredError } from "@hospital/domain";
import {
	createInMemoryAppointmentWriteRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryPatientRepository,
	createInMemoryPaymentOperationsRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryUserProfileRepository,
	createInMemoryWechatRefundRepository,
	createNotConfiguredRepositories,
	type MySqlRepositories,
} from "@hospital/persistence";
import {
	type ApplicationServiceOptions,
	createDefaultApplicationServices,
	selectReadyRepositories,
} from "./application";
import { resolveRegistrationRefundUnavailableReason } from "./modules/admin/wechat-refund-service";
import { NativeIntelligentGuideService } from "./modules/intelligent-guide";

const repositories = {} as MySqlRepositories;

test("入口配置将退费回写的服务端授权缺失与通用结算配置分开判断", () => {
	const environment = {
		YUNHEALTH_REGISTRATION_SETTLEMENT_READY: "true",
		YUNHEALTH_BASE_URL: "https://hospital-gateway.example.test",
		YUNHEALTH_PAYMENT_ORG_ID: "1",
		YUNHEALTH_PLUGIN_PAY_TYPE_ID: "5033",
		YUNHEALTH_PLUGIN_PAY_TYPE: "CREDIT",
		YUNHEALTH_PLUGIN_PAYMENT_SOURCE: "1",
		YUNHEALTH_AUTH_SYS_CODE: "fixture-auth-system",
		YUNHEALTH_PLUGIN_TRADE_TYPE_CODE: "10",
	};
	for (const authorization of [undefined, "synthetic-refund-writeback-token"]) {
		const runtime = loadRuntimeConfig({
			...environment,
			YUNHEALTH_AUTH_TOKEN: authorization,
		});
		const settlementStatus =
			yunhealthRegistrationSettlementConfigurationStatus(runtime);
		expect(settlementStatus).toBe("configured");
		expect(
			resolveRegistrationRefundUnavailableReason({
				cancellationConfigured: true,
				writeBackConfigured: settlementStatus === "configured",
				writeBackAuthorized: Boolean(runtime.yunhealthAuthorizationToken),
			}),
		).toBe(authorization ? undefined : "write_back_authorization_missing");
	}
	for (const baseUrl of [
		"https://gpsrmyy.meiyi.pro",
		"https://other.example.test",
	]) {
		const runtime = loadRuntimeConfig({
			...environment,
			YUNHEALTH_REGISTRATION_REFUND_AUTH_MODE: "signed-relay",
			YUNHEALTH_BASE_URL: baseUrl,
		});
		const authorizationStatus =
			yunhealthRegistrationRefundAuthorizationStatus(runtime);
		expect(
			resolveRegistrationRefundUnavailableReason({
				cancellationConfigured: true,
				writeBackConfigured: true,
				writeBackAuthorized: authorizationStatus === "configured",
				writeBackAuthenticationSupported: authorizationStatus !== "unsupported",
			}),
		).toBe(
			baseUrl === "https://gpsrmyy.meiyi.pro"
				? undefined
				: "authentication_not_supported",
		);
	}
});

test("API only installs production repositories after the schema probe passes", () => {
	expect(selectReadyRepositories(repositories, "ok")).toBe(repositories);
	expect(selectReadyRepositories(repositories, "unavailable")).toBeUndefined();
	expect(
		selectReadyRepositories(repositories, "not_configured"),
	).toBeUndefined();
	expect(selectReadyRepositories(undefined, "ok")).toBeUndefined();
});

test("default application composition prefers the native TS guide when its ports are ready", () => {
	const directory = {
		async listDepartments() {
			return {
				departments: [],
				trace: { provider: "test", operation: "test", requestId: "test" },
			};
		},
		async listSchedules() {
			return {
				schedules: [],
				trace: { provider: "test", operation: "test", requestId: "test" },
			};
		},
	} satisfies AppointmentDirectoryGateway;
	const conversations = {
		async load() {
			return undefined;
		},
		async save() {},
	} satisfies IntelligentGuideConversationStateStore;

	const services = createDefaultApplicationServices({
		appointmentDirectoryGateway: directory,
		intelligentGuideConversationStates: conversations,
	});

	expect(services.intelligentGuide).toBeInstanceOf(
		NativeIntelligentGuideService,
	);
});

test("default application composition does not revive the legacy guide fallback", () => {
	const services = createDefaultApplicationServices();

	expect(services.intelligentGuide).toBeUndefined();
});

test("closed patient binding does not invoke legacy auth before missing binding gateway", async () => {
	let authCalls = 0;
	const services = createDefaultApplicationServices({
		patientProviderAuthorizationGateway: {
			async exchangeWechatCode() {
				authCalls += 1;
				throw new Error("legacy auth must not run");
			},
		},
	});

	await expect(
		services.patientBinding?.bind(
			"fixture-closed-binding-owner",
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "11010519900101007X",
				consent: true,
				legacyLoginCode: "wx-code-closed",
			},
			{
				traceId: "closed-binding-trace",
				idempotencyKey: "closed-binding-idem",
			},
		),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);
	expect(authCalls).toBe(0);
});

test("挂号退款组合根仅在取消和回写能力齐全时开放，缺失原因如实进入读模型", async () => {
	const order: PaymentOrder = {
		orderId: "capability-composition-payment",
		ownerUserId: "capability-composition-owner",
		patientId: "capability-composition-patient",
		idempotencyKey: "registration-self-pay:capability-composition-appointment",
		amounts: { totalFen: 300, cashFen: 300, insuranceFen: 0 },
		state: "completed",
		version: 5,
		createdAt: "2026-10-16T03:00:00.000Z",
		updatedAt: "2026-10-16T03:00:00.000Z",
	};
	const configured: ApplicationServiceOptions = {
		appointmentWriteGateway: {} as never,
		registrationSelfPayRefundNotificationGateway: {} as never,
	};
	const signedRelay: ApplicationServiceOptions = {
		appointmentWriteGateway: {} as never,
		registrationSelfPayRefundNotificationGateway:
			createYunhealthRegistrationSelfPayRefundNotificationGateway({
				baseUrl: "https://gpsrmyy.meiyi.pro",
				refundAuthorizationMode: "signed-relay",
				paymentOrgId: "1",
				pluginPayTypeId: "5033",
				pluginPayType: "CREDIT",
				workStationId: "",
				paymentSource: "1",
				fetcher: async () => {
					throw new Error("capability history must not contact the relay");
				},
			}),
	};
	const cases: [ApplicationServiceOptions, string | undefined][] = [
		[{}, "取消挂号服务未配置"],
		[{ appointmentWriteGateway: {} as never }, "医院退费回写服务未配置"],
		[
			{
				appointmentWriteGateway: {} as never,
				registrationRefundUnavailableReason: "write_back_authorization_missing",
			},
			"医院退费回写缺少服务端授权",
		],
		[
			{
				...configured,
				registrationRefundUnavailableReason: "write_back_authorization_missing",
			},
			"医院退费回写缺少服务端授权",
		],
		[configured, undefined],
		[signedRelay, undefined],
		[
			{
				...configured,
				registrationRefundUnavailableReason: "authentication_not_supported",
			},
			"医院退费回写鉴权配置不受支持",
		],
	];
	for (const [options, reason] of cases) {
		const services = createDefaultApplicationServices({
			...options,
			repositories: {
				...createNotConfiguredRepositories(),
				appointmentWrites: createInMemoryAppointmentWriteRepository(),
				paymentOrders: createInMemoryPaymentOrderRepository([order]),
				medicalInsuranceOrders: createInMemoryMedicalInsuranceOrderRepository(),
				wechatRefunds: createInMemoryWechatRefundRepository(),
				paymentOperations: createInMemoryPaymentOperationsRepository(),
				patients: createInMemoryPatientRepository(),
				userProfiles: createInMemoryUserProfileRepository(),
			} as unknown as MySqlRepositories,
			wechatRefundGateway: {
				async requestRefund() {
					throw new Error("capability history must not request a refund");
				},
				async queryRefund() {
					throw new Error("capability history must not query a refund");
				},
			},
		});
		const item = (
			await services.wechatRefund?.listPaymentHistory({
				source: "payment_order",
			})
		)?.items[0];
		expect(item?.refundOptions.ALL.enabled).toBe(reason === undefined);
		expect(item?.refundOptions.CASH.enabled).toBe(reason === undefined);
		if (reason) expect(item?.refundOptions.ALL.reason).toContain(reason);
		else expect(item?.refundOptions.ALL).not.toHaveProperty("reason");
	}
});

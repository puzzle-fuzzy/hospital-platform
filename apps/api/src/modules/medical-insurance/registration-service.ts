import { createHash } from "node:crypto";
import type {
	MedicalInsuranceAuthorizationContextPayload,
	MedicalInsuranceAuthorizePayload,
	MedicalInsuranceBusinessRecoveryPayload,
	MedicalInsuranceOrderPayload,
} from "@hospital/contracts";
import {
	type AppointmentMedicalInsuranceContext,
	type AppointmentPatientProfileGateway,
	type AppointmentRegistration,
	type AppointmentWriteRepository,
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	type MedicalInsuranceAuthorizationRepository,
	type MedicalInsuranceCredentialRepository,
	type MedicalInsuranceGateway,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceQueryTaskRepository,
	medicalInsuranceOrderTypeForBusiness,
	normalizeAdapterCallContext,
	normalizeOutpatientPaymentRecords,
	type OutpatientMedicalInsuranceContext,
	type OutpatientPaymentGateway,
	type PatientRepository,
	PaymentNotificationConflictError,
	PaymentPrepayAttemptInProgressError,
	type UserIdentityRepository,
	validatePatientProviderReference,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import {
	MedicalInsuranceOrderNotFoundError,
	MedicalInsuranceRegionUnsupportedError,
	MedicalInsuranceRegistrationInputError,
} from "./errors";
import { MedicalInsurancePaymentCore } from "./payment-core";
import {
	loadMedicalInsurancePaymentPresentation,
	type MedicalInsurancePaymentPresentation,
} from "./payment-presentation";
import {
	type MedicalInsurancePaymentEligibility,
	medicalInsurancePaymentEligibility,
} from "./payment-region";

export {
	MedicalInsuranceOrderNotFoundError,
	MedicalInsuranceRegionUnsupportedError,
	MedicalInsuranceRegistrationInputError,
} from "./errors";

export class MedicalInsuranceAppointmentNotFoundError extends Error {
	constructor() {
		super("Appointment for medical insurance was not found");
		this.name = "MedicalInsuranceAppointmentNotFoundError";
	}
}

/** 医保支付不能继续复用超过有效窗口的旧预约。 */
export class MedicalInsuranceAppointmentStaleError extends Error {
	constructor() {
		super("Appointment for medical insurance has expired; reacquire a source");
		this.name = "MedicalInsuranceAppointmentStaleError";
	}
}

export type MedicalInsuranceRegistrationServiceDependencies = {
	orders: MedicalInsuranceOrderRepository;
	authorizations: MedicalInsuranceAuthorizationRepository;
	appointments: AppointmentWriteRepository;
	assertAppointmentPaymentAllowed?: (
		ownerUserId: string,
		appointmentId: string,
		context: unknown,
	) => Promise<void>;
	patients: PatientRepository;
	identityUsers: UserIdentityRepository;
	patientProfile: AppointmentPatientProfileGateway;
	medicalInsurance: MedicalInsuranceGateway;
	/** 6201 回包先落加密凭证、后更新订单；用于崩溃窗口内的本地事实恢复。 */
	credentials?: MedicalInsuranceCredentialRepository;
	/** 门诊医保入口复用同一门诊 2.6.33 事实解析，不从客户端接收 Provider 订单号。 */
	outpatientPayments?: OutpatientPaymentGateway;
	/** 可注入统一核心；省略时为兼容旧组合根自动创建同一核心实现。 */
	core?: MedicalInsurancePaymentCore;
	/** 兼容旧组合根，实际由统一核心持有。 */
	queryTasks?: MedicalInsuranceQueryTaskRepository;
	logger?: AppLogger;
	now?: () => Date;
	createId?: () => string;
};

function contextOf(value: unknown) {
	const context = normalizeAdapterCallContext(value);
	if (!context)
		throw new MedicalInsuranceRegistrationInputError(
			"Medical insurance context is invalid",
		);
	return context;
}

function opaque(value: unknown, label: string): string {
	if (!isBoundedOpaqueIdentifier(value))
		throw new MedicalInsuranceRegistrationInputError(`${label} is invalid`);
	return value;
}

function output(
	order: MedicalInsuranceOrder,
	cashierUrl?: unknown,
	presentation: MedicalInsurancePaymentPresentation = {},
): MedicalInsuranceOrderPayload["data"] {
	const safeCashierUrl =
		typeof cashierUrl === "string" && cashierUrl.length <= 2048
			? (() => {
					try {
						const parsed = new URL(cashierUrl);
						return parsed.protocol === "https:" ? cashierUrl : undefined;
					} catch {
						return undefined;
					}
				})()
			: undefined;
	return {
		orderId: order.medicalOrderId,
		status: order.status,
		...(order.amounts
			? {
					amounts: {
						totalFen: order.amounts.totalFen,
						insuranceFen:
							order.amounts.personalAccountFen +
							order.amounts.fundFen +
							(order.amounts.otherPaymentFen ?? 0),
						cashFen: order.amounts.cashFen,
						...presentation,
					},
				}
			: {}),
		...(safeCashierUrl ? { cashierUrl: safeCashierUrl } : {}),
	};
}

function emptySettlementPatch(order: MedicalInsuranceOrder) {
	return {
		status: order.status,
		ordStas: order.ordStas,
		amounts: order.amounts,
		setlType: order.setlType,
		revsTokenHash: order.revsTokenHash,
		revsTokenExpiresAt: order.revsTokenExpiresAt,
	};
}

const REGISTRATION_ORDER_TYPE =
	medicalInsuranceOrderTypeForBusiness("registration");
/** 支付上下文有效期；超过后必须重新获取号源并重新预约。 */
const MEDICAL_PAYMENT_CONTEXT_MAX_AGE_MS = 15 * 60 * 1000;
/** 授权写请求刚创建订单时，后续点击先查询，避免结果未知时立刻重复消费授权码。 */
const AUTHORIZATION_SUBMISSION_GRACE_MS = 2 * 60 * 1000;
/** 发送门禁刚写入时，先给同一进程中的 6201 回包和本地落库留出窗口。 */
const FEE_UPLOAD_SUBMISSION_GRACE_MS = 2 * 60 * 1000;

export class MedicalInsuranceRegistrationService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;
	private readonly createId: () => string;
	private readonly core: MedicalInsurancePaymentCore;

	constructor(
		private readonly dependencies: MedicalInsuranceRegistrationServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
		this.createId = dependencies.createId ?? (() => crypto.randomUUID());
		this.core =
			dependencies.core ??
			new MedicalInsurancePaymentCore({
				orders: dependencies.orders,
				medicalInsurance: dependencies.medicalInsurance,
				...(dependencies.queryTasks
					? { queryTasks: dependencies.queryTasks }
					: {}),
				...(dependencies.logger ? { logger: dependencies.logger } : {}),
				...(dependencies.now ? { now: dependencies.now } : {}),
			});
	}

	private async output(
		order: MedicalInsuranceOrder,
		cashierUrl?: unknown,
	): Promise<MedicalInsuranceOrderPayload["data"]> {
		return output(
			order,
			cashierUrl,
			await loadMedicalInsurancePaymentPresentation(
				order,
				this.dependencies.orders,
			),
		);
	}

	/**
	 * Provider 授权适配器会先把加密授权上下文落库，再把 authorizationId
	 * 回写订单。若进程在两步之间退出，同一幂等请求必须修复本地引用，不能
	 * 再消费一次授权码或重跑 1101。
	 */
	private async restorePersistedAuthorization(
		order: MedicalInsuranceOrder,
	): Promise<MedicalInsuranceOrder> {
		if (order.status !== "created" || order.authorizationId) return order;
		const authorization =
			await this.dependencies.authorizations.getActiveForOrder({
				ownerUserId: order.ownerUserId,
				medicalOrderId: order.medicalOrderId,
				now: this.now().toISOString(),
			});
		if (!authorization) return order;
		const restored = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...emptySettlementPatch(order),
				authorizationId: authorization.authorizationId,
			},
		);
		if (restored) {
			this.logger.info(
				{
					event: "medical-insurance.authorization.local-context-restored",
					ownerUserId: order.ownerUserId,
					orderId: order.medicalOrderId,
				},
				"Medical insurance authorization restored from persisted local context",
			);
			return restored;
		}
		const latest = await this.dependencies.orders.findByMedicalOrderId(
			order.medicalOrderId,
		);
		if (!latest || latest.ownerUserId !== order.ownerUserId) {
			throw new MedicalInsuranceOrderNotFoundError();
		}
		return latest;
	}

	private async businessOrders(input: {
		ownerUserId: string;
		businessType: "registration" | "outpatient";
		businessId: string;
	}): Promise<readonly MedicalInsuranceOrder[]> {
		const list = this.dependencies.orders.listByOwnerAndBusinessKey;
		if (list) {
			return list(input.ownerUserId, input.businessType, input.businessId);
		}
		const latest = await this.dependencies.orders.findByOwnerAndBusinessKey?.(
			input.ownerUserId,
			input.businessType,
			input.businessId,
		);
		return latest ? [latest] : [];
	}

	private async activeBusinessOrders(input: {
		ownerUserId: string;
		businessType: "registration" | "outpatient";
		businessId: string;
		patientId: string;
	}): Promise<readonly MedicalInsuranceOrder[]> {
		const orders = (await this.businessOrders(input)).filter(
			(order) => order.status !== "cancelled",
		);
		// 同一业务键只要存在患者不一致的活动订单，就不能由客户端传入的患者
		// 标识选择另一笔；统一按未找到处理，避免串患者和枚举订单。
		if (orders.some((order) => order.patientId !== input.patientId)) {
			throw new MedicalInsuranceOrderNotFoundError();
		}
		return orders;
	}

	private async paymentEligibilityForBusiness(input: {
		ownerUserId: string;
		businessType: "registration" | "outpatient";
		businessId: string;
		patientId: string;
	}): Promise<MedicalInsurancePaymentEligibility> {
		const orders = (await this.businessOrders(input))
			.filter(
				(order) =>
					order.ownerUserId === input.ownerUserId &&
					order.patientId === input.patientId &&
					(order.businessType ?? "registration") === input.businessType &&
					(order.businessId ?? order.appointmentId) === input.businessId,
			)
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
		const order = orders[0];
		if (order) {
			// 已取消的地区拒绝授权仍保留审计；仅在原授权有效期内复用资格。
			const authorization = order.authorizationId
				? await this.dependencies.authorizations.get({
						authorizationId: order.authorizationId,
						ownerUserId: input.ownerUserId,
						medicalOrderId: order.medicalOrderId,
						now: this.now().toISOString(),
					})
				: await this.dependencies.authorizations.getActiveForOrder({
						ownerUserId: input.ownerUserId,
						medicalOrderId: order.medicalOrderId,
						now: this.now().toISOString(),
					});
			if (authorization) {
				return medicalInsurancePaymentEligibility(authorization.insuplcAdmdvs);
			}
		}
		return "unknown";
	}

	/** 仅撤销从未进入医院写入的空订单，保留授权引用供审计和当前资格查询。 */
	private async assertSupportedAuthorization(
		order: MedicalInsuranceOrder,
		insuredAreaCode: unknown,
	): Promise<void> {
		const eligibility = medicalInsurancePaymentEligibility(insuredAreaCode);
		if (eligibility === "unknown") {
			throw new DependencyNotConfiguredError(
				"medical-insurance-authorization-region",
			);
		}
		if (eligibility === "supported") return;
		if (
			order.status === "created" &&
			!order.feeUploadId &&
			!order.payOrdId &&
			!order.payTokenHash &&
			!order.mdtrtId &&
			!order.amounts &&
			!order.wechatMixTradeNo &&
			!order.wechatOutTradeNo &&
			(!order.wechatPaymentState ||
				order.wechatPaymentState === "not_started") &&
			!(await this.dependencies.orders.getSettlementContext(
				order.ownerUserId,
				order.medicalOrderId,
			))
		) {
			await this.dependencies.orders.applySettlement(
				order.medicalOrderId,
				order.version,
				{ ...emptySettlementPatch(order), status: "cancelled" },
			);
		}
		throw new MedicalInsuranceRegionUnsupportedError();
	}

	private async assertOrderAuthorizationSupported(
		order: MedicalInsuranceOrder,
	): Promise<void> {
		const authorization = order.authorizationId
			? await this.dependencies.authorizations.get({
					authorizationId: order.authorizationId,
					ownerUserId: order.ownerUserId,
					medicalOrderId: order.medicalOrderId,
					now: this.now().toISOString(),
				})
			: undefined;
		if (!authorization) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance authorization is required",
			);
		}
		await this.assertSupportedAuthorization(order, authorization.insuplcAdmdvs);
	}

	private async insertOrReuseBusinessOrder(
		candidate: MedicalInsuranceOrder,
	): Promise<{ order: MedicalInsuranceOrder; createdForRequest: boolean }> {
		const result =
			await this.dependencies.orders.insertForBusinessIfAbsent(candidate);
		if (
			result.orders.some((order) => order.patientId !== candidate.patientId)
		) {
			throw new MedicalInsuranceOrderNotFoundError();
		}
		if (result.orders.length > 1) {
			throw new PaymentNotificationConflictError();
		}
		const order = result.orders[0];
		if (!order) {
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		}
		const createdForRequest =
			result.inserted && order.medicalOrderId === candidate.medicalOrderId;
		if (result.inserted && !createdForRequest) {
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		}
		return { order, createdForRequest };
	}

	private authorizationSubmissionPending(
		order: MedicalInsuranceOrder,
	): boolean {
		if (order.status !== "created" || order.authorizationId) return false;
		const updatedAt = Date.parse(order.updatedAt);
		const ageMs = this.now().getTime() - updatedAt;
		// 数据库时钟可能比 API 快几毫秒。未来时间必须按仍在确认中处理，
		// 不能因为 age 为负就放行第二次不可重放授权。
		return (
			Number.isFinite(updatedAt) && ageMs < AUTHORIZATION_SUBMISSION_GRACE_MS
		);
	}

	/**
	 * 授权确认窗口结束后，同一 created 订单也可能被两个设备同时点击。
	 * 在再次调用 Provider 前先用订单版本做一次同状态 CAS；只有胜者可以
	 * 消费新的授权码，败者只能观察服务端状态，不能依赖页面 busy 防并发。
	 */
	private async claimAuthorizationSubmission(
		order: MedicalInsuranceOrder,
	): Promise<{
		order: MedicalInsuranceOrder;
		claimed: boolean;
		authorizationReady: boolean;
	}> {
		const claimed = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			emptySettlementPatch(order),
		);
		if (claimed) {
			return { order: claimed, claimed: true, authorizationReady: false };
		}
		const latest = await this.dependencies.orders.findByMedicalOrderId(
			order.medicalOrderId,
		);
		if (!latest || latest.ownerUserId !== order.ownerUserId) {
			throw new MedicalInsuranceOrderNotFoundError();
		}
		const observed = await this.restorePersistedAuthorization(latest);
		if (observed.status === "failed" || observed.status === "manual_review") {
			throw new PaymentNotificationConflictError();
		}
		if (observed.status === "cancelled") {
			throw new MedicalInsuranceRegistrationInputError(
				"本次医保授权尝试已作废，请重新展码授权",
			);
		}
		if (observed.status !== "created") {
			return { order: observed, claimed: false, authorizationReady: true };
		}
		const authorizationReady = Boolean(
			observed.authorizationId &&
				(await this.dependencies.authorizations.get({
					authorizationId: observed.authorizationId,
					ownerUserId: observed.ownerUserId,
					medicalOrderId: observed.medicalOrderId,
					now: this.now().toISOString(),
				})),
		);
		return { order: observed, claimed: false, authorizationReady };
	}

	private async markFeeUploadForManualReview(
		order: MedicalInsuranceOrder,
		reason: string,
	): Promise<MedicalInsuranceOrder> {
		const reviewed = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...emptySettlementPatch(order),
				status: "manual_review",
			},
		);
		const latest =
			reviewed ??
			(await this.dependencies.orders.findByMedicalOrderId(
				order.medicalOrderId,
			));
		if (!latest || latest.ownerUserId !== order.ownerUserId) {
			throw new MedicalInsuranceOrderNotFoundError();
		}
		this.logger.warn(
			{
				event: "medical-insurance.fee-upload.manual-review",
				ownerUserId: order.ownerUserId,
				orderId: order.medicalOrderId,
				reason,
			},
			"Medical insurance fee upload requires manual review",
		);
		return latest;
	}

	/**
	 * adapter 已经保存 6201 凭证后，另一个恢复请求可能先把订单推进，导致
	 * 原请求最后一次 CAS 失败。此时先核对最新订单是否就是同一份 6201 事实；
	 * 一致则返回最新状态，只有字段冲突才转人工，不能把成功恢复误报成依赖故障。
	 */
	private async resolveFeeUploadPersistenceRace(
		claimedOrder: MedicalInsuranceOrder,
		result: Awaited<ReturnType<MedicalInsuranceGateway["uploadFees"]>>,
	): Promise<MedicalInsuranceOrderPayload["data"]> {
		const latest = await this.dependencies.orders.findByMedicalOrderId(
			claimedOrder.medicalOrderId,
		);
		if (!latest || latest.ownerUserId !== claimedOrder.ownerUserId) {
			throw new MedicalInsuranceOrderNotFoundError();
		}
		const samePersistedFacts =
			latest.feeUploadId === result.feeUploadId &&
			latest.payOrdId === result.payOrdId &&
			latest.payTokenHash === result.payTokenHash &&
			latest.mdtrtId === result.mdtrtId &&
			latest.acctUsedFlag === result.acctUsedFlag;
		if (
			samePersistedFacts &&
			latest.status !== "created" &&
			latest.status !== "fee_upload_pending"
		) {
			this.logger.info(
				{
					event: "medical-insurance.fee-upload.persistence-race-resolved",
					ownerUserId: latest.ownerUserId,
					orderId: latest.medicalOrderId,
					status: latest.status,
				},
				"Medical insurance fee upload reused the concurrently persisted result",
			);
			return this.output(latest, result.cashierUrl);
		}
		return this.output(
			await this.markFeeUploadForManualReview(
				latest,
				"6201-persisted-result-conflict",
			),
			result.cashierUrl,
		);
	}

	/**
	 * 6201 回包中的 payToken 会先进入加密凭证仓储，完整结算上下文也会先
	 * 标记 fee_uploaded，最后才 CAS 更新订单。这里从两份 owner/order 绑定
	 * 的本地事实恢复订单；任一凭证缺失、冲突或过期都转人工，绝不重放 6201。
	 */
	private async recoverPersistedFeeUpload(
		order: MedicalInsuranceOrder,
	): Promise<MedicalInsuranceOrderPayload["data"] | undefined> {
		const settlement = await this.dependencies.orders.getSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
		);
		if (
			order.status === "fee_upload_pending" &&
			settlement?.feeUploadStage !== "submitting_6201" &&
			settlement?.feeUploadStage !== "fee_uploaded"
		) {
			const claimedAt = Date.parse(order.updatedAt);
			const ageMs = this.now().getTime() - claimedAt;
			if (
				Number.isFinite(claimedAt) &&
				ageMs < FEE_UPLOAD_SUBMISSION_GRACE_MS
			) {
				return this.output(order, settlement?.cashierUrl);
			}
			return this.output(
				await this.markFeeUploadForManualReview(
					order,
					settlement?.feeUploadStage === "pre_6201"
						? "6201-prepared-result-missing"
						: "6201-claim-result-missing",
				),
				settlement?.cashierUrl,
			);
		}
		if (
			settlement?.feeUploadStage !== "submitting_6201" &&
			settlement?.feeUploadStage !== "fee_uploaded"
		) {
			return undefined;
		}
		if (settlement.feeUploadStage === "submitting_6201") {
			const submittedAt = Date.parse(settlement.feeUploadSubmittedAt ?? "");
			const ageMs = this.now().getTime() - submittedAt;
			if (
				Number.isFinite(submittedAt) &&
				ageMs < FEE_UPLOAD_SUBMISSION_GRACE_MS
			) {
				// 同一时刻的第二个请求只观察 created/确认中，不改变版本，给第一
				// 个请求保存回包留出时间；客户端会保留原订单后再次查询。
				return this.output(order, settlement.cashierUrl);
			}
			return this.output(
				await this.markFeeUploadForManualReview(
					order,
					"6201-submission-result-missing",
				),
				settlement.cashierUrl,
			);
		}

		const credentials = this.dependencies.credentials;
		if (
			!credentials ||
			!settlement.mdtrtId ||
			(settlement.acctUsedFlag !== "0" && settlement.acctUsedFlag !== "1")
		) {
			return this.output(
				await this.markFeeUploadForManualReview(
					order,
					"6201-persisted-context-incomplete",
				),
				settlement.cashierUrl,
			);
		}
		const now = this.now().toISOString();
		const [settlementCredential, queryCredential] = await Promise.all([
			credentials.getActiveForOrder({
				ownerUserId: order.ownerUserId,
				medicalOrderId: order.medicalOrderId,
				purpose: "settlement",
				now,
			}),
			credentials.getActiveForOrder({
				ownerUserId: order.ownerUserId,
				medicalOrderId: order.medicalOrderId,
				purpose: "query",
				now,
			}),
		]);
		if (
			!settlementCredential ||
			!queryCredential ||
			settlementCredential.payOrdId !== queryCredential.payOrdId ||
			settlementCredential.payToken !== queryCredential.payToken
		) {
			return this.output(
				await this.markFeeUploadForManualReview(
					order,
					"6201-persisted-credentials-incomplete",
				),
				settlement.cashierUrl,
			);
		}
		const restored = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...emptySettlementPatch(order),
				status: "fee_uploaded",
				feeUploadId: settlementCredential.credentialId,
				payOrdId: settlementCredential.payOrdId,
				payTokenHash: createHash("sha256")
					.update(settlementCredential.payToken, "utf8")
					.digest("hex"),
				mdtrtId: settlement.mdtrtId,
				acctUsedFlag: settlement.acctUsedFlag,
			},
		);
		const latest =
			restored ??
			(await this.dependencies.orders.findByMedicalOrderId(
				order.medicalOrderId,
			));
		if (!latest || latest.ownerUserId !== order.ownerUserId) {
			throw new MedicalInsuranceOrderNotFoundError();
		}
		this.logger.info(
			{
				event: "medical-insurance.fee-upload.local-context-restored",
				ownerUserId: order.ownerUserId,
				orderId: order.medicalOrderId,
			},
			"Medical insurance fee upload restored from persisted local context",
		);
		return this.output(latest, settlement.cashierUrl);
	}

	/**
	 * 在进入可能产生上游写事实的费用上传适配器前先 CAS 抢占发送权。
	 * 客户端每次点击都会生成新的 HTTP 幂等键，因此真正的并发门禁必须绑定
	 * 服务端订单版本；抢占失败的请求只能读取赢家留下的状态，不能调用 Provider。
	 */
	private async claimFeeUploadSubmission(
		order: MedicalInsuranceOrder,
	): Promise<{ order: MedicalInsuranceOrder; claimed: boolean }> {
		const claimed = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...emptySettlementPatch(order),
				status: "fee_upload_pending",
			},
		);
		if (claimed) return { order: claimed, claimed: true };
		const latest = await this.dependencies.orders.findByMedicalOrderId(
			order.medicalOrderId,
		);
		if (!latest || latest.ownerUserId !== order.ownerUserId) {
			throw new MedicalInsuranceOrderNotFoundError();
		}
		return { order: latest, claimed: false };
	}

	private async appointment(
		ownerUserId: string,
		appointmentId: string,
		allowInactive = false,
	): Promise<AppointmentRegistration> {
		const appointment = await this.dependencies.appointments.findRegistration(
			ownerUserId,
			appointmentId,
		);
		if (!appointment || (!allowInactive && appointment.status !== "booked"))
			throw new MedicalInsuranceAppointmentNotFoundError();
		return appointment;
	}

	private async patient(
		ownerUserId: string,
		patientId: string,
		context: ReturnType<typeof contextOf>,
	) {
		const identity =
			await this.dependencies.identityUsers.findByUserId(ownerUserId);
		if (!identity?.unionId || !identity.providerSubject)
			throw new MedicalInsuranceRegistrationInputError(
				"微信身份未完成 unionId/openid 绑定，无法解析医保授权",
			);
		// 预约记录里的 providerPatientId 是 patInfosFind 返回的 HIS patId，
		// 而 patientInfoByUnionId 使用的是目录 thirdPatientId。两者不能互相
		// 当作查询键；这里按 owner + 平台 patientId 重新取得 directory 引用，
		// 再让 profile gateway 解析实名资料，避免医保授权阶段把 HIS patId
		// 错拿去匹配微信目录患者。
		const directoryReference =
			await this.dependencies.patients.resolveProviderReference({
				ownerUserId,
				patientId,
				provider: "zhongyang",
				referenceKind: "directory",
			});
		if (!directoryReference)
			throw new MedicalInsuranceRegistrationInputError(
				"当前就诊人缺少众阳目录映射，无法解析医保授权",
			);
		const referenceViolation = validatePatientProviderReference(
			directoryReference,
			patientId,
		);
		if (referenceViolation)
			throw new MedicalInsuranceRegistrationInputError(
				"当前就诊人的众阳目录映射无效，无法解析医保授权",
			);
		const result = await this.dependencies.patientProfile.resolve(
			{
				unionId: identity.unionId,
				providerPatientId: directoryReference.providerPatientId,
			},
			context,
		);
		return { identity, patient: result.patient };
	}

	private async outpatientProviderContext(
		ownerUserId: string,
		patientId: string,
		recordId: string,
		context: ReturnType<typeof contextOf>,
	) {
		const gateway = this.dependencies.outpatientPayments;
		if (!gateway?.resolvePaymentContext) {
			throw new DependencyNotConfiguredError("outpatient-payment-context");
		}
		const reference = await this.dependencies.patients.resolveProviderReference(
			{
				ownerUserId,
				patientId,
				provider: "zhongyang",
				referenceKind: "his-patient",
			},
		);
		if (!reference || validatePatientProviderReference(reference, patientId)) {
			throw new MedicalInsuranceRegistrationInputError(
				"当前就诊人缺少众阳门诊缴费映射，无法发起医保支付",
			);
		}
		const now = this.now();
		const providerDateTime = (value: Date): string => {
			const parts = new Intl.DateTimeFormat("en-CA", {
				timeZone: "Asia/Shanghai",
				calendar: "gregory",
				numberingSystem: "latn",
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
				hourCycle: "h23",
			}).formatToParts(value);
			const values = Object.fromEntries(
				parts
					.filter((part) => part.type !== "literal")
					.map((part) => [part.type, part.value]),
			);
			return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
		};
		const resolved = await gateway.resolvePaymentContext(
			{
				providerPatientId: reference.providerPatientId,
				recordId,
				startTime: providerDateTime(
					new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
				),
				endTime: providerDateTime(now),
			},
			context,
		);
		if (
			resolved.recordId !== recordId ||
			resolved.providerPatientId !== reference.providerPatientId ||
			!Number.isSafeInteger(resolved.totalFen) ||
			resolved.totalFen <= 0 ||
			resolved.outTradeOrderIds.length === 0
		) {
			throw new MedicalInsuranceRegistrationInputError(
				"门诊缴费事实不可用，无法发起医保支付",
			);
		}
		if (resolved.record !== undefined) {
			const snapshot = normalizeOutpatientPaymentRecords(
				[resolved.record],
				"unpaid",
			)[0];
			if (
				!snapshot ||
				snapshot.recordId !== recordId ||
				snapshot.amountFen !== resolved.totalFen
			) {
				throw new MedicalInsuranceRegistrationInputError(
					"门诊费用快照与本次缴费事实不一致",
				);
			}
			return { ...resolved, record: snapshot };
		}
		return resolved;
	}

	private async authorizationContextForPatient(input: {
		ownerUserId: string;
		patientId: string;
		businessId: string;
		context: ReturnType<typeof contextOf>;
	}): Promise<MedicalInsuranceAuthorizationContextPayload["data"]> {
		const patients = await this.dependencies.patients.listByOwner(
			input.ownerUserId,
		);
		const selected = patients.find(
			(candidate) => candidate.id === input.patientId,
		);
		if (!selected) {
			throw new MedicalInsuranceRegistrationInputError(
				"当前就诊人未关联有效患者档案，无法发起医保授权",
			);
		}
		const medicalInsurancePaymentEligibility =
			await this.paymentEligibilityForBusiness({
				ownerUserId: input.ownerUserId,
				businessType: "outpatient",
				businessId: input.businessId,
				patientId: input.patientId,
			});
		if (selected.relationship === "unknown") {
			this.logger.warn(
				{
					event: "medical-insurance.authorization.relationship-fallback",
					traceId: input.context.traceId,
					ownerUserId: input.ownerUserId,
					businessId: input.businessId,
					assumedRelationship: "self",
				},
				"Unknown patient relationship temporarily treated as self",
			);
			return { payForRelatives: false, medicalInsurancePaymentEligibility };
		}
		if (selected.relationship === "self")
			return { payForRelatives: false, medicalInsurancePaymentEligibility };
		const selfPatients = patients.filter(
			(candidate) => candidate.relationship === "self",
		);
		if (selfPatients.length !== 1 || !selfPatients[0]) {
			throw new MedicalInsuranceRegistrationInputError(
				"当前微信用户缺少唯一的本人就诊人档案，无法代亲属支付",
			);
		}
		const { identity, patient } = await this.patient(
			input.ownerUserId,
			input.patientId,
			input.context,
		);
		const payerReference =
			await this.dependencies.patients.resolveProviderReference({
				ownerUserId: input.ownerUserId,
				patientId: selfPatients[0].id,
				provider: "zhongyang",
				referenceKind: "directory",
			});
		if (
			!payerReference ||
			validatePatientProviderReference(payerReference, selfPatients[0].id)
		) {
			throw new MedicalInsuranceRegistrationInputError(
				"本人就诊人缺少有效的众阳目录映射，无法代亲属支付",
			);
		}
		if (!identity.unionId) {
			throw new MedicalInsuranceRegistrationInputError(
				"微信身份缺少 unionId，无法代亲属支付",
			);
		}
		await this.dependencies.patientProfile.resolve(
			{
				unionId: identity.unionId,
				providerPatientId: payerReference.providerPatientId,
			},
			input.context,
		);
		const patientName = patient.name.trim();
		const patientIdNo = patient.idNo.trim().toUpperCase();
		if (!patientName || patientIdNo.length < 4) {
			throw new MedicalInsuranceRegistrationInputError(
				"亲属实名资料不完整，无法生成亲情付授权标识",
			);
		}
		return {
			medicalInsurancePaymentEligibility,
			payForRelatives: true,
			familyId: createHash("md5")
				.update(`${patientName}${patientIdNo.slice(-4)}`, "utf8")
				.digest("hex"),
		};
	}

	/**
	 * 医保授权跳转前按预约锁定的就诊人决定是否进入亲情付授权。
	 * 仅向小程序返回官方要求的 familyId 摘要；支付人与就诊人的完整实名资料继续只在
	 * 服务端 Provider 调用帧内解析。
	 */
	async authorizationContext(input: {
		ownerUserId: string;
		appointmentId: string;
		context: unknown;
	}): Promise<MedicalInsuranceAuthorizationContextPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const appointmentId = opaque(input.appointmentId, "appointmentId");
		await this.dependencies.assertAppointmentPaymentAllowed?.(
			ownerUserId,
			appointmentId,
			context,
		);
		const appointment = await this.appointment(ownerUserId, appointmentId);
		const patients = await this.dependencies.patients.listByOwner(ownerUserId);
		const selected = patients.find(
			(candidate) => candidate.id === appointment.patientId,
		);
		if (!selected) {
			throw new MedicalInsuranceRegistrationInputError(
				"当前预约未关联有效就诊人，无法发起医保授权",
			);
		}
		const medicalInsurancePaymentEligibility =
			await this.paymentEligibilityForBusiness({
				ownerUserId,
				businessType: "registration",
				businessId: appointmentId,
				patientId: appointment.patientId,
			});
		// 临时验收兼容：当前众阳 patient-list 可能把 relation 返回为空，
		// 目录层会将其规范化为 unknown。为避免医保主链路在展码前被阻断，
		// 本轮测试按院方确认将 unknown 暂时视为本人；保留独立告警事件，
		// 后续接入权威本人/亲属关系后应恢复严格判断。
		if (selected.relationship === "unknown") {
			this.logger.warn(
				{
					event: "medical-insurance.authorization.relationship-fallback",
					traceId: context.traceId,
					ownerUserId,
					appointmentId,
					assumedRelationship: "self",
				},
				"Unknown patient relationship temporarily treated as self",
			);
			return { payForRelatives: false, medicalInsurancePaymentEligibility };
		}
		if (selected.relationship === "self")
			return { payForRelatives: false, medicalInsurancePaymentEligibility };

		const selfPatients = patients.filter(
			(candidate) => candidate.relationship === "self",
		);
		if (selfPatients.length !== 1 || !selfPatients[0]) {
			throw new MedicalInsuranceRegistrationInputError(
				"当前微信用户缺少唯一的本人就诊人档案，无法代亲属支付",
			);
		}
		const { identity, patient } = await this.patient(
			ownerUserId,
			appointment.patientId,
			context,
		);
		const payerReference =
			await this.dependencies.patients.resolveProviderReference({
				ownerUserId,
				patientId: selfPatients[0].id,
				provider: "zhongyang",
				referenceKind: "directory",
			});
		if (
			!payerReference ||
			validatePatientProviderReference(payerReference, selfPatients[0].id)
		) {
			throw new MedicalInsuranceRegistrationInputError(
				"本人就诊人缺少有效的众阳目录映射，无法代亲属支付",
			);
		}
		// 提前验证支付人的实名档案可解析，避免用户完成亲情授权后才在下单处失败。
		const payerUnionId = identity.unionId;
		if (!payerUnionId) {
			throw new MedicalInsuranceRegistrationInputError(
				"微信身份缺少 unionId，无法代亲属支付",
			);
		}
		await this.dependencies.patientProfile.resolve(
			{
				unionId: payerUnionId,
				providerPatientId: payerReference.providerPatientId,
			},
			context,
		);
		const patientName = patient.name.trim();
		const patientIdNo = patient.idNo.trim().toUpperCase();
		if (!patientName || patientIdNo.length < 4) {
			throw new MedicalInsuranceRegistrationInputError(
				"亲属实名资料不完整，无法生成亲情付授权标识",
			);
		}
		return {
			medicalInsurancePaymentEligibility,
			payForRelatives: true,
			familyId: createHash("md5")
				.update(`${patientName}${patientIdNo.slice(-4)}`, "utf8")
				.digest("hex"),
		};
	}

	/** 门诊医保授权跳转前复用同一亲情付判定，并确认 recordId 仍属于当前患者。 */
	async outpatientAuthorizationContext(input: {
		ownerUserId: string;
		recordId: string;
		patientId: string;
		context: unknown;
	}): Promise<MedicalInsuranceAuthorizationContextPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const recordId = opaque(input.recordId, "recordId");
		const patientId = opaque(input.patientId, "patientId");
		await this.outpatientProviderContext(
			ownerUserId,
			patientId,
			recordId,
			context,
		);
		return this.authorizationContextForPatient({
			ownerUserId,
			patientId,
			businessId: recordId,
			context,
		});
	}

	/**
	 * 无客户端 pending 的统一恢复入口。按钮每次点击都调用这里，以服务端订单
	 * 为准决定恢复、重新授权或人工处理；本地缓存和上一页按钮状态不参与判定。
	 */
	async recoverBusinessOrder(input: {
		ownerUserId: string;
		businessType: "registration" | "outpatient";
		businessId: string;
		patientId: string;
		context: unknown;
	}): Promise<MedicalInsuranceBusinessRecoveryPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const businessId = opaque(input.businessId, "businessId");
		const patientId = opaque(input.patientId, "patientId");
		if (
			input.businessType !== "registration" &&
			input.businessType !== "outpatient"
		) {
			throw new MedicalInsuranceRegistrationInputError(
				"businessType is invalid",
			);
		}
		const active = await this.activeBusinessOrders({
			ownerUserId,
			businessType: input.businessType,
			businessId,
			patientId,
		});
		if (!active[0]) throw new MedicalInsuranceOrderNotFoundError();
		if (active.length > 1) {
			this.logger.warn(
				{
					event: "medical-insurance.business-order.ambiguous",
					traceId: context.traceId,
					ownerUserId,
					businessType: input.businessType,
					businessId,
					activeOrderCount: active.length,
				},
				"Multiple active medical insurance orders require manual review",
			);
			throw new PaymentNotificationConflictError();
		}
		let order = active[0];
		order = await this.restorePersistedAuthorization(order);
		if (order.status === "created" || order.status === "fee_upload_pending") {
			await this.recoverPersistedFeeUpload(order);
			order =
				(await this.dependencies.orders.findByMedicalOrderId(
					order.medicalOrderId,
				)) ?? order;
		}
		const settlement = await this.dependencies.orders.getSettlementContext(
			ownerUserId,
			order.medicalOrderId,
		);
		let authorizationReady = order.status !== "created";
		if (!authorizationReady && order.authorizationId) {
			authorizationReady = Boolean(
				await this.dependencies.authorizations.get({
					authorizationId: order.authorizationId,
					ownerUserId,
					medicalOrderId: order.medicalOrderId,
					now: this.now().toISOString(),
				}),
			);
		}
		const authorizationPending =
			!authorizationReady && this.authorizationSubmissionPending(order);
		const recoveryAllowed =
			order.status !== "manual_review" && order.status !== "failed";
		this.logger.info(
			{
				event: "medical-insurance.business-order.recovered",
				traceId: context.traceId,
				ownerUserId,
				orderId: order.medicalOrderId,
				businessType: input.businessType,
				businessId,
				status: order.status,
				authorizationReady,
				authorizationPending,
				recoveryAllowed,
			},
			"Medical insurance business order recovered without client cache",
		);
		return {
			...(await this.output(order, settlement?.cashierUrl)),
			authorizationReady,
			authorizationPending,
			recoveryAllowed,
		};
	}

	/**
	 * 门诊医保授权。订单仍进入同一 MedicalInsurancePaymentCore，后续 fees、settle、
	 * 微信支付和查单路由完全共用挂号实现；只有业务键和 2.6.33 门诊事实不同。
	 */
	async authorizeOutpatient(input: {
		ownerUserId: string;
		recordId: string;
		patientId: string;
		authCode: string;
		context: unknown;
	}): Promise<MedicalInsuranceAuthorizePayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const recordId = opaque(input.recordId, "recordId");
		const patientId = opaque(input.patientId, "patientId");
		if (
			typeof input.authCode !== "string" ||
			!input.authCode.trim() ||
			input.authCode.length > 512
		)
			throw new MedicalInsuranceRegistrationInputError("authCode is invalid");
		const providerContext = await this.outpatientProviderContext(
			ownerUserId,
			patientId,
			recordId,
			context,
		);
		let order = await this.dependencies.orders.findByOwnerAndIdempotencyKey(
			ownerUserId,
			context.idempotencyKey,
		);
		let createdForRequest = false;
		if (
			order &&
			(order.businessType !== "outpatient" ||
				order.businessId !== recordId ||
				order.patientId !== patientId)
		)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance idempotency key conflicts with outpatient record",
			);
		if (!order) {
			const active = await this.activeBusinessOrders({
				ownerUserId,
				businessType: "outpatient",
				businessId: recordId,
				patientId,
			});
			if (active.length > 1) {
				throw new PaymentNotificationConflictError();
			}
			order = active[0];
		}
		if (order?.status === "cancelled") {
			throw new MedicalInsuranceRegistrationInputError(
				"本次医保授权尝试已作废，请重新展码授权",
			);
		}
		// 新客户端请求键也必须先复用同一业务的唯一活动订单；只有服务端确认
		// 没有活动单时才创建。授权阶段不自动调用关单链路。
		if (!order) {
			const now = this.now().toISOString();
			const medicalOrderId = this.createId();
			const claimed = await this.insertOrReuseBusinessOrder({
				medicalOrderId,
				ownerUserId,
				patientId,
				businessType: "outpatient",
				orderType: "DiagPay",
				businessId: recordId,
				authorizationId: null,
				feeUploadId: null,
				idempotencyKey: context.idempotencyKey,
				medOrgOrd: medicalOrderId,
				chrgBchno: this.createId().replaceAll("-", ""),
				payOrdId: null,
				payTokenHash: null,
				mdtrtId: null,
				acctUsedFlag: null,
				status: "created",
				ordStas: null,
				amounts: null,
				setlType: null,
				revsTokenHash: null,
				revsTokenExpiresAt: null,
				lastError: null,
				version: 1,
				createdAt: now,
				updatedAt: now,
			});
			order = claimed.order;
			createdForRequest = claimed.createdForRequest;
		}
		order = await this.restorePersistedAuthorization(order);
		if (order.status === "cancelled") {
			throw new MedicalInsuranceRegistrationInputError(
				"本次医保授权尝试已作废，请重新展码授权",
			);
		}
		if (order.status === "failed" || order.status === "manual_review") {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance order requires manual review",
			);
		}
		if (order.status !== "created") {
			return { orderId: order.medicalOrderId, status: "authorized" };
		}
		if (order.authorizationId) {
			const authorization = await this.dependencies.authorizations.get({
				authorizationId: order.authorizationId,
				ownerUserId,
				medicalOrderId: order.medicalOrderId,
				now: this.now().toISOString(),
			});
			if (authorization) {
				await this.assertSupportedAuthorization(
					order,
					authorization.insuplcAdmdvs,
				);
				return { orderId: order.medicalOrderId, status: "authorized" };
			}
			// created 且短期授权已过期时可以在同一未支付订单上接受新的授权码；
			// 不创建第二笔业务订单，也不把旧客户端缓存当成恢复依据。
		}
		if (!createdForRequest && this.authorizationSubmissionPending(order)) {
			throw new PaymentPrepayAttemptInProgressError();
		}
		if (!createdForRequest) {
			const claim = await this.claimAuthorizationSubmission(order);
			if (!claim.claimed) {
				if (claim.authorizationReady) {
					if (claim.order.status === "created") {
						await this.assertOrderAuthorizationSupported(claim.order);
					}
					return { orderId: claim.order.medicalOrderId, status: "authorized" };
				}
				throw new PaymentPrepayAttemptInProgressError();
			}
			order = claim.order;
		}
		const { identity, patient } = await this.patient(
			ownerUserId,
			patientId,
			context,
		);
		const result = await this.dependencies.medicalInsurance.authorize(
			{
				authCode: input.authCode,
				patientId: providerContext.providerPatientId,
				ownerUserId,
				orderId: order.medicalOrderId,
				providerSubject: identity.providerSubject,
				patient,
			},
			context,
		);
		const authorization = await this.dependencies.authorizations.get({
			authorizationId: result.authorizationId,
			ownerUserId,
			medicalOrderId: order.medicalOrderId,
			now: this.now().toISOString(),
		});
		if (!authorization)
			throw new DependencyNotConfiguredError(
				"medical-insurance-authorization-context",
			);
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...emptySettlementPatch(order),
				authorizationId: result.authorizationId,
				businessType: "outpatient",
				orderType: "DiagPay",
				businessId: recordId,
			},
		);
		if (!updated)
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		await this.assertSupportedAuthorization(
			updated,
			authorization.insuplcAdmdvs,
		);
		return { orderId: updated.medicalOrderId, status: "authorized" };
	}

	async authorize(input: {
		ownerUserId: string;
		appointmentId: string;
		authCode: string;
		context: unknown;
	}): Promise<MedicalInsuranceAuthorizePayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const appointmentId = opaque(input.appointmentId, "appointmentId");
		if (
			typeof input.authCode !== "string" ||
			!input.authCode.trim() ||
			input.authCode.length > 512
		)
			throw new MedicalInsuranceRegistrationInputError("authCode is invalid");
		const appointment = await this.appointment(
			ownerUserId,
			appointmentId,
			Boolean(this.dependencies.assertAppointmentPaymentAllowed),
		);
		const appointmentCreatedAt = Date.parse(appointment.createdAt);
		const appointmentAge = this.now().getTime() - appointmentCreatedAt;
		let order = await this.dependencies.orders.findByOwnerAndIdempotencyKey(
			ownerUserId,
			context.idempotencyKey,
		);
		let createdForRequest = false;
		if (
			order &&
			((order.appointmentId !== undefined &&
				order.appointmentId !== appointmentId) ||
				(order.businessId !== undefined &&
					order.businessId !== appointmentId) ||
				(order.businessType !== undefined &&
					order.businessType !== "registration") ||
				order.patientId !== appointment.patientId)
		)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance idempotency key conflicts with appointment",
			);
		if (!order) {
			const active = await this.activeBusinessOrders({
				ownerUserId,
				businessType: "registration",
				businessId: appointmentId,
				patientId: appointment.patientId,
			});
			if (active.length > 1) {
				throw new PaymentNotificationConflictError();
			}
			order = active[0];
		}
		if (order?.status === "cancelled") {
			throw new MedicalInsuranceRegistrationInputError(
				"本次医保授权尝试已作废，请重新展码授权",
			);
		}
		// 生产以医院当前截止和预约状态决定新发起权限。旧隔离测试未注入
		// 医院查询时才保留 15 分钟兼容边界；已推进订单仍按原单恢复。
		if (
			(!order || order.status === "created") &&
			this.dependencies.assertAppointmentPaymentAllowed
		) {
			await this.dependencies.assertAppointmentPaymentAllowed(
				ownerUserId,
				appointmentId,
				context,
			);
		}
		if (
			!this.dependencies.assertAppointmentPaymentAllowed &&
			!order &&
			(!Number.isFinite(appointmentCreatedAt) ||
				appointmentAge < 0 ||
				appointmentAge > MEDICAL_PAYMENT_CONTEXT_MAX_AGE_MS)
		) {
			this.logger.warn(
				{
					event: "medical-insurance.authorization.stale-appointment",
					traceId: context.traceId,
					ownerUserId,
					appointmentId,
					appointmentAgeMs: Number.isFinite(appointmentAge)
						? appointmentAge
						: undefined,
					maxAgeMs: MEDICAL_PAYMENT_CONTEXT_MAX_AGE_MS,
				},
				"Medical insurance authorization rejected stale new appointment",
			);
			throw new MedicalInsuranceAppointmentStaleError();
		}
		// 同一授权幂等键恢复同一次请求；新请求键也已在上方按挂号业务键查找
		// 唯一活动单，只有确实不存在时才创建新订单。
		if (!order) {
			const now = this.now().toISOString();
			const medicalOrderId = this.createId();
			const newOrder: MedicalInsuranceOrder = {
				medicalOrderId,
				ownerUserId,
				patientId: appointment.patientId,
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
				businessId: appointmentId,
				appointmentId,
				authorizationId: null,
				feeUploadId: null,
				idempotencyKey: context.idempotencyKey,
				medOrgOrd: medicalOrderId,
				chrgBchno: this.createId().replaceAll("-", ""),
				payOrdId: null,
				payTokenHash: null,
				mdtrtId: null,
				acctUsedFlag: null,
				status: "created",
				ordStas: null,
				amounts: null,
				setlType: null,
				revsTokenHash: null,
				revsTokenExpiresAt: null,
				lastError: null,
				version: 1,
				createdAt: now,
				updatedAt: now,
			};
			const claimed = await this.insertOrReuseBusinessOrder(newOrder);
			order = claimed.order;
			createdForRequest = claimed.createdForRequest;
		}
		order = await this.restorePersistedAuthorization(order);
		if (order.status === "cancelled") {
			throw new MedicalInsuranceRegistrationInputError(
				"本次医保授权尝试已作废，请重新展码授权",
			);
		}
		if (order.status === "failed" || order.status === "manual_review") {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance order requires manual review",
			);
		}
		if (order.status !== "created") {
			return { orderId: order.medicalOrderId, status: "authorized" };
		}
		if (order.authorizationId) {
			const authorization = await this.dependencies.authorizations.get({
				authorizationId: order.authorizationId,
				ownerUserId,
				medicalOrderId: order.medicalOrderId,
				now: this.now().toISOString(),
			});
			if (authorization) {
				await this.assertSupportedAuthorization(
					order,
					authorization.insuplcAdmdvs,
				);
				return { orderId: order.medicalOrderId, status: "authorized" };
			}
			// 与门诊一致：授权过期只允许在同一 created 订单上换新授权码。
		}
		if (!createdForRequest && this.authorizationSubmissionPending(order)) {
			throw new PaymentPrepayAttemptInProgressError();
		}
		if (!createdForRequest) {
			const claim = await this.claimAuthorizationSubmission(order);
			if (!claim.claimed) {
				if (claim.authorizationReady) {
					if (claim.order.status === "created") {
						await this.assertOrderAuthorizationSupported(claim.order);
					}
					return { orderId: claim.order.medicalOrderId, status: "authorized" };
				}
				throw new PaymentPrepayAttemptInProgressError();
			}
			order = claim.order;
		}
		const { identity, patient } = await this.patient(
			ownerUserId,
			appointment.patientId,
			context,
		);
		this.logger.info(
			{
				event: "medical-insurance.authorization.requested",
				traceId: context.traceId,
				ownerUserId,
				orderId: order.medicalOrderId,
				appointmentId,
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
			},
			"Medical insurance authorization requested",
		);
		const result = await this.dependencies.medicalInsurance.authorize(
			{
				authCode: input.authCode,
				patientId: appointment.providerPatientId,
				ownerUserId,
				orderId: order.medicalOrderId,
				providerSubject: identity.providerSubject,
				patient,
			},
			context,
		);
		const authorization = await this.dependencies.authorizations.get({
			authorizationId: result.authorizationId,
			ownerUserId,
			medicalOrderId: order.medicalOrderId,
			now: this.now().toISOString(),
		});
		if (!authorization) {
			throw new DependencyNotConfiguredError(
				"medical-insurance-authorization-context",
			);
		}
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...emptySettlementPatch(order),
				authorizationId: result.authorizationId,
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
				businessId: appointmentId,
				appointmentId,
			},
		);
		if (!updated)
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		this.logger.info(
			{
				event: "medical-insurance.authorization.completed",
				traceId: context.traceId,
				ownerUserId,
				orderId: order.medicalOrderId,
				appointmentId,
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance authorization completed",
		);
		await this.assertSupportedAuthorization(
			updated,
			authorization.insuplcAdmdvs,
		);
		return { orderId: updated.medicalOrderId, status: "authorized" };
	}

	async uploadFees(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order || order.ownerUserId !== ownerUserId)
			throw new MedicalInsuranceOrderNotFoundError();
		if (order.businessType === "outpatient") {
			return this.uploadOutpatientFees({ ownerUserId, orderId, context });
		}
		if (
			(order.businessType && order.businessType !== "registration") ||
			(order.orderType && order.orderType !== "RegPay")
		)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance order business type is not registration",
			);
		if (order.status === "fee_upload_pending") {
			return (
				(await this.recoverPersistedFeeUpload(order)) ?? this.output(order)
			);
		}
		if (order.status !== "created") {
			// 终态或已推进订单必须先返回持久化事实。取消/人工复核时授权或
			// 费用上下文可能已经按清理策略置空；若先校验这些过程字段，客户端
			// 恢复原单会被误报成“缺少授权”，并失去 cancelled/manual_review
			// 这一真正决定后续操作权限的权威状态。
			const context = await this.dependencies.orders.getSettlementContext(
				ownerUserId,
				orderId,
			);
			return this.output(order, context?.cashierUrl);
		}
		const recoveredFeeUpload = await this.recoverPersistedFeeUpload(order);
		if (recoveredFeeUpload) return recoveredFeeUpload;
		if (!order.authorizationId || !order.appointmentId)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance authorization is required",
			);
		await this.dependencies.assertAppointmentPaymentAllowed?.(
			ownerUserId,
			order.appointmentId,
			context,
		);
		const appointment = await this.appointment(
			ownerUserId,
			order.appointmentId,
		);
		await this.assertOrderAuthorizationSupported(order);
		const claim = await this.claimFeeUploadSubmission(order);
		if (!claim.claimed) {
			return (
				(await this.recoverPersistedFeeUpload(claim.order)) ??
				this.output(claim.order)
			);
		}
		const claimedOrder = claim.order;
		this.logger.info(
			{
				event: "medical-insurance.fees.requested",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				appointmentId: appointment.appointmentId,
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
			},
			"Medical insurance fee upload requested",
		);
		const result = await this.dependencies.medicalInsurance.uploadFees(
			{
				orderId,
				ownerUserId,
				patientId: appointment.providerPatientId,
				authorizationId: claimedOrder.authorizationId ?? order.authorizationId,
				appointment: {
					appointmentId: appointment.appointmentId,
					providerAppointmentId: appointment.providerAppointmentId,
					providerPatientId: appointment.providerPatientId,
					...(appointment.providerRegisterId
						? { providerRegisterId: appointment.providerRegisterId }
						: {}),
					...(appointment.providerHisRegisterId
						? { providerHisRegisterId: appointment.providerHisRegisterId }
						: {}),
					...(appointment.departmentId
						? { departmentId: appointment.departmentId }
						: {}),
					departmentName: appointment.departmentName,
					...(appointment.doctorId ? { doctorId: appointment.doctorId } : {}),
					doctorName: appointment.doctorName,
					workDate: appointment.workDate,
					shiftName: appointment.shiftName,
					sourceSerialNumber: appointment.sourceSerialNumber,
					totalFen: appointment.totalFen,
				} satisfies AppointmentMedicalInsuranceContext,
			},
			context,
		);
		const updated = await this.dependencies.orders.applySettlement(
			claimedOrder.medicalOrderId,
			claimedOrder.version,
			{
				...emptySettlementPatch(claimedOrder),
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
				businessId: appointment.appointmentId,
				status: "fee_uploaded",
				feeUploadId: result.feeUploadId,
				payOrdId: result.payOrdId,
				payTokenHash: result.payTokenHash,
				mdtrtId: result.mdtrtId,
				acctUsedFlag: result.acctUsedFlag,
			},
		);
		if (!updated) {
			return this.resolveFeeUploadPersistenceRace(claimedOrder, result);
		}
		this.logger.info(
			{
				event: "medical-insurance.fees.completed",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				appointmentId: appointment.appointmentId,
				businessType: "registration",
				orderType: REGISTRATION_ORDER_TYPE,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance fee upload completed",
		);
		return this.output(updated, result.cashierUrl);
	}

	/** 门诊 6201：重新解析同一 2.6.33 待缴事实，再进入统一医保 adapter。 */
	async uploadOutpatientFees(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order || order.ownerUserId !== ownerUserId)
			throw new MedicalInsuranceOrderNotFoundError();
		if (
			order.businessType !== "outpatient" ||
			order.orderType !== "DiagPay" ||
			!order.businessId
		)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance order business type is not outpatient",
			);
		if (order.status === "fee_upload_pending") {
			return (
				(await this.recoverPersistedFeeUpload(order)) ?? this.output(order)
			);
		}
		if (order.status !== "created") {
			// 与挂号一致，恢复请求先读取订单状态；不能让已经取消或转人工的
			// DiagPay 因过程凭证已清理而退化成可误解的授权校验错误。
			const settlement = await this.dependencies.orders.getSettlementContext(
				ownerUserId,
				orderId,
			);
			return this.output(order, settlement?.cashierUrl);
		}
		const recoveredFeeUpload = await this.recoverPersistedFeeUpload(order);
		if (recoveredFeeUpload) return recoveredFeeUpload;
		if (!order.authorizationId)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance authorization is required",
			);
		const providerContext = await this.outpatientProviderContext(
			ownerUserId,
			order.patientId,
			order.businessId,
			context,
		);
		await this.assertOrderAuthorizationSupported(order);
		const claim = await this.claimFeeUploadSubmission(order);
		if (!claim.claimed) {
			return (
				(await this.recoverPersistedFeeUpload(claim.order)) ??
				this.output(claim.order)
			);
		}
		const claimedOrder = claim.order;
		this.logger.info(
			{
				event: "medical-insurance.fees.requested",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				recordId: order.businessId,
				businessType: "outpatient",
				orderType: "DiagPay",
			},
			"Medical insurance outpatient fee upload requested",
		);
		const business: OutpatientMedicalInsuranceContext = {
			businessType: "outpatient",
			recordId: order.businessId,
			...(providerContext.record
				? { outpatientPaymentRecord: providerContext.record }
				: {}),
			providerPatientId: providerContext.providerPatientId,
			outTradeOrderIds: providerContext.outTradeOrderIds,
			totalFen: providerContext.totalFen,
		};
		const result = await this.dependencies.medicalInsurance.uploadFees(
			{
				orderId,
				ownerUserId,
				patientId: providerContext.providerPatientId,
				authorizationId: claimedOrder.authorizationId ?? order.authorizationId,
				appointment: business,
			},
			context,
		);
		const updated = await this.dependencies.orders.applySettlement(
			claimedOrder.medicalOrderId,
			claimedOrder.version,
			{
				...emptySettlementPatch(claimedOrder),
				businessType: "outpatient",
				orderType: "DiagPay",
				businessId: order.businessId,
				status: "fee_uploaded",
				feeUploadId: result.feeUploadId,
				payOrdId: result.payOrdId,
				payTokenHash: result.payTokenHash,
				mdtrtId: result.mdtrtId,
				acctUsedFlag: result.acctUsedFlag,
			},
		);
		if (!updated) {
			return this.resolveFeeUploadPersistenceRace(claimedOrder, result);
		}
		this.logger.info(
			{
				event: "medical-insurance.fees.completed",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				recordId: order.businessId,
				businessType: "outpatient",
				orderType: "DiagPay",
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance outpatient fee upload completed",
		);
		return this.output(updated, result.cashierUrl);
	}

	async cashier(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order || order.ownerUserId !== ownerUserId)
			throw new MedicalInsuranceOrderNotFoundError();
		const settlementContext =
			await this.dependencies.orders.getSettlementContext(ownerUserId, orderId);
		this.logger.info(
			{
				event: "medical-insurance.cashier.requested",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				hasCashierUrl: Boolean(settlementContext?.cashierUrl),
			},
			"Medical insurance cashier context requested",
		);
		return this.output(order, settlementContext?.cashierUrl);
	}

	async settle(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		return this.core.settle(input);
	}

	async query(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
		cashPaymentConfirmed?: boolean;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		return this.core.query(input);
	}

	async cancel(input: {
		ownerUserId: string;
		orderId: string;
		reason: "payment_in_progress" | "reauthorization";
		context: unknown;
	}): Promise<
		import("@hospital/contracts").MedicalInsuranceCancellationPayload["data"]
	> {
		return this.core.cancel(input);
	}

	async confirmWechatCashPayment(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		return this.core.confirmWechatCashPayment(input);
	}

	async confirmCashierPayment(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		return this.core.query({
			...input,
			cashPaymentConfirmed: true,
		});
	}
}

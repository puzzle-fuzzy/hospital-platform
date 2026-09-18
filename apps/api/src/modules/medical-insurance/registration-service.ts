import { createHash } from "node:crypto";
import type {
	MedicalInsuranceAuthorizationContextPayload,
	MedicalInsuranceAuthorizePayload,
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
	type MedicalInsuranceGateway,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceQueryTaskRepository,
	medicalInsuranceOrderTypeForBusiness,
	normalizeAdapterCallContext,
	type OutpatientMedicalInsuranceContext,
	type OutpatientPaymentGateway,
	type PatientRepository,
	type UserIdentityRepository,
	validatePatientProviderReference,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import {
	MedicalInsuranceOrderNotFoundError,
	MedicalInsuranceRegistrationInputError,
} from "./errors";
import { MedicalInsurancePaymentCore } from "./payment-core";

export {
	MedicalInsuranceOrderNotFoundError,
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
	patients: PatientRepository;
	identityUsers: UserIdentityRepository;
	patientProfile: AppointmentPatientProfileGateway;
	medicalInsurance: MedicalInsuranceGateway;
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

	private async appointment(
		ownerUserId: string,
		appointmentId: string,
	): Promise<AppointmentRegistration> {
		const appointment = await this.dependencies.appointments.findRegistration(
			ownerUserId,
			appointmentId,
		);
		if (appointment?.status !== "booked")
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
			return { payForRelatives: false };
		}
		if (selected.relationship === "self") return { payForRelatives: false };
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
			return { payForRelatives: false };
		}
		if (selected.relationship === "self") return { payForRelatives: false };

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
		if (
			order &&
			(order.businessType !== "outpatient" ||
				order.businessId !== recordId ||
				order.patientId !== patientId)
		)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance idempotency key conflicts with outpatient record",
			);
		if (order?.status === "cancelled") {
			throw new MedicalInsuranceRegistrationInputError(
				"本次医保授权尝试已作废，请重新展码授权",
			);
		}
		// 门诊每次收到新的医保授权码都创建独立的新医保订单。
		// 只有同一 idempotencyKey 才恢复原请求；不按 recordId 检测或关闭旧订单，
		// 避免授权阶段误触发 2.6.65.4/2.6.65.11 关单链路。
		if (!order) {
			const now = this.now().toISOString();
			const medicalOrderId = this.createId();
			order = await this.dependencies.orders.insert({
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
		}
		if (order.authorizationId) {
			const authorization = await this.dependencies.authorizations.get({
				authorizationId: order.authorizationId,
				ownerUserId,
				medicalOrderId: order.medicalOrderId,
				now: this.now().toISOString(),
			});
			if (!authorization)
				throw new MedicalInsuranceRegistrationInputError(
					"医保授权上下文不可用，请重新完成医保授权",
				);
			return { orderId: order.medicalOrderId, status: "authorized" };
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
		const appointment = await this.appointment(ownerUserId, appointmentId);
		const appointmentCreatedAt = Date.parse(appointment.createdAt);
		const appointmentAge = this.now().getTime() - appointmentCreatedAt;
		let order = await this.dependencies.orders.findByOwnerAndIdempotencyKey(
			ownerUserId,
			context.idempotencyKey,
		);
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
		if (order?.status === "cancelled") {
			throw new MedicalInsuranceRegistrationInputError(
				"本次医保授权尝试已作废，请重新展码授权",
			);
		}
		// 15 分钟只限制创建新的医保订单。同一次幂等重试必须继续按原单恢复，
		// 否则客户端本地上下文过期会让已扣款订单永久失联。先校验再关闭旧单，
		// 避免一个已经失效的新授权尝试破坏仍需查单的旧支付事实。
		if (
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
		// 同一个授权幂等键只恢复同一次回跳；新幂等键直接创建独立的新医保
		// 订单，不按 appointmentId 查找、校验或关闭重复/旧订单。
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
			order = await this.dependencies.orders.insert(newOrder);
		}
		if (order.authorizationId) {
			const authorization = await this.dependencies.authorizations.get({
				authorizationId: order.authorizationId,
				ownerUserId,
				medicalOrderId: order.medicalOrderId,
				now: this.now().toISOString(),
			});
			if (!authorization) {
				throw new MedicalInsuranceRegistrationInputError(
					"医保授权上下文不可用，请重新完成医保授权",
				);
			}
			return { orderId: order.medicalOrderId, status: "authorized" };
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
		if (!order.authorizationId || !order.appointmentId)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance authorization is required",
			);
		if (order.status !== "created") {
			const context = await this.dependencies.orders.getSettlementContext(
				ownerUserId,
				orderId,
			);
			return output(order, context?.cashierUrl);
		}
		const appointment = await this.appointment(
			ownerUserId,
			order.appointmentId,
		);
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
				authorizationId: order.authorizationId,
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
			order.medicalOrderId,
			order.version,
			{
				...emptySettlementPatch(order),
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
		if (!updated)
			throw new DependencyNotConfiguredError("medical-insurance-orders");
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
		return output(updated, result.cashierUrl);
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
		if (!order.authorizationId)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance authorization is required",
			);
		if (order.status !== "created") {
			const settlement = await this.dependencies.orders.getSettlementContext(
				ownerUserId,
				orderId,
			);
			return output(order, settlement?.cashierUrl);
		}
		const providerContext = await this.outpatientProviderContext(
			ownerUserId,
			order.patientId,
			order.businessId,
			context,
		);
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
			providerPatientId: providerContext.providerPatientId,
			outTradeOrderIds: providerContext.outTradeOrderIds,
			totalFen: providerContext.totalFen,
		};
		const result = await this.dependencies.medicalInsurance.uploadFees(
			{
				orderId,
				ownerUserId,
				patientId: providerContext.providerPatientId,
				authorizationId: order.authorizationId,
				appointment: business,
			},
			context,
		);
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...emptySettlementPatch(order),
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
		if (!updated)
			throw new DependencyNotConfiguredError("medical-insurance-orders");
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
		return output(updated, result.cashierUrl);
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
		return output(order, settlementContext?.cashierUrl);
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
